import { randomUUID } from 'node:crypto';
import prisma from '@/app/api/_lib/db';
import { getSpaceForUser, resolveAgent, resolveSpaceMemberModelConfig, SPACE_COORDINATOR } from '@/app/api/_lib/spaces';
import { createChatWebTools } from '../web/auto-web';
import { getReadOnlyExternalCapabilityIds } from '../capabilities/registry.mjs';
import { collectChatCompletionStream, runToolLoop } from '../agents/runtime/tool-loop.mjs';
import { currentTimeContext } from '../agents/memory/current-time-context.mjs';
import { RESPONSE_GROUNDING_GUIDANCE } from '../chat/conversation-grounding.mjs';
import { prepareSpaceMessageRuntime } from './space-message-runtime';
import { createScheduler } from '../core/scheduler.mjs';
import { FOLLOW_UP_ACTIVE_LIMIT, FOLLOW_UP_LEASE_MS, FOLLOW_UP_MAX_ATTEMPTS, FOLLOW_UP_MAX_CHAIN_DEPTH, canContinueFollowUp, followUpChainEndsAt, followUpContext, normalizeFollowUpContinuation } from './follow-up-policy.mjs';
import { extractCryptoSymbolFromText } from '../workspace/crypto/okx-analysis.mjs';
import { queryCryptoMarket } from '../workspace/crypto/market-tools';
import { followUpNotificationTool, getFollowUpQQAvailability, queueFollowUpQQNotification } from './follow-up-notifications';
import { normalizeFollowUpNotification } from './follow-up-notification-policy.mjs';

export async function generateSpaceFollowUp(task: any) {
  const space = await getSpaceForUser(task.spaceId, task.space.userId);
  if (!space || space.templateId !== 'crypto-contract-trading' || space.runtimeType === 'PI_CODING') throw new Error('空间已不存在或不支持自主跟进');
  if (!space.cryptoAutonomyEnabled) throw new Error('空间自主复查已关闭');
  if (task.agentId !== SPACE_COORDINATOR.id && !space.members.some(member => member.agentId === task.agentId)) {
    throw new Error('负责跟进的成员已不在空间中');
  }
  const agent = await resolveAgent(task.agentId, space.userId);
  if (!agent) throw new Error('负责跟进的成员不可用');
  const config = await resolveSpaceMemberModelConfig({ spaceId: space.id, agentId: agent.id, userId: space.userId, space });
  if (!config.client) throw new Error('当前成员没有可用的大模型配置');
  const recent = await prisma.spaceMessage.findMany({ where: { spaceId: space.id }, orderBy: { createdAt: 'desc' }, take: 16 });
  const history = recent.reverse().map(message => ({ role: message.role, content: message.content, speakerAgentId: message.speakerAgentId }));
  const runtime = await prepareSpaceMessageRuntime({
    spaceId: space.id, templateId: space.templateId, workspaceType: space.workspaceType,
    agentId: agent.id, textMessage: task.prompt, persistedMessages: history, deferMarketQuery: true,
  });
  const symbol = extractCryptoSymbolFromText(task.prompt) || extractCryptoSymbolFromText(task.title);
  let marketContext = '';
  if (symbol) {
    if (!task.networkAllowed) throw new Error('本次行情复查没有联网授权');
    const snapshot = await queryCryptoMarket('crypto_market_snapshot', { symbol });
    if (!snapshot) throw new Error(`未取得 ${symbol} 的可靠新行情`);
    marketContext = `【本次复查新获取的 OKX USDT 永续行情】\n${JSON.stringify(snapshot)}\n缺失字段不得当作0或自行补全；以各字段数据时间为准。`;
  }
  const user = await prisma.user.findUnique({ where: { id: space.userId }, select: { tavilyApiKey: true, defaultWeatherLocation: true } });
  const signal = AbortSignal.timeout(90_000);
  const web = createChatWebTools({
    apiKey: user?.tavilyApiKey, defaultWeatherLocation: user?.defaultWeatherLocation,
    query: task.prompt, history, signal, capabilityEntry: 'space', phase: 'chat',
    permittedCapabilities: task.networkAllowed ? getReadOnlyExternalCapabilityIds('space') : [],
    cryptoContext: data => runtime.marketContext?.(data) || '',
  });
  const startedAt = task.startedAt ? new Date(task.startedAt) : new Date();
  const mayContinue = canContinueFollowUp(task, startedAt);
  const qqAvailability = space.cryptoFollowUpQQEnabled ? await getFollowUpQQAvailability(space.userId) : null;
  const mayNotify = qqAvailability?.ready === true;
  let qqNotification: ReturnType<typeof normalizeFollowUpNotification> | undefined;
  let nextFollowUp: ReturnType<typeof normalizeFollowUpContinuation> | undefined;
  const continuationTool = {
    type: 'function', function: {
      name: 'schedule_next_space_follow_up',
      description: '本轮自主复查后确有必要继续观察时，提出下一次复查及理由；随本轮结果一起保存。每轮至多安排一个后续，至少间隔15分钟，限同一跟进主题。',
      parameters: { type: 'object', additionalProperties: false, required: ['title', 'prompt', 'runAt', 'reason'], properties: {
        title: { type: 'string', maxLength: 100 },
        prompt: { type: 'string', maxLength: 4000, description: '延续本次主题，包含本轮新判断、比较基准和下一次要核验的事项及标的。' },
        runAt: { type: 'string', description: '带时区的ISO日期时间，至少间隔15分钟，必须在本轮跟进的截止时间之前。' },
        reason: { type: 'string', maxLength: 500, description: '为什么仍需要观察、为什么选择这个时点，例如等待下一根1H收线。' },
      } },
    },
  };
  const messages: any[] = [{ role: 'system', content: [
    currentTimeContext(), agent.systemPrompt || agent.description || `你是${agent.name}。`,
    space.instructions ? `空间规则：${space.instructions}` : '',
    runtime.promptContext, marketContext, runtime.agentPolicy({ agentId: agent.id, isCoordinator: agent.id === SPACE_COORDINATOR.id }),
    RESPONSE_GROUNDING_GUIDANCE, web.guidance,
    '这是一次已经保存的自主复查。不要等待用户再提问，直接完成本次复查并向用户汇报。先说变化或结论，再给必要证据，默认不超过600字。',
    '必须对照安排时的判断和需要核验的事项。涉及当前价格、新闻或其他时效信息必须依据本次复查新获取的数据；系统未提供的时效资料必须实际调用查询工具，并给出数据时间。查询失败或关键数据缺失时如实说明，禁止把旧数据写成最新结果。',
    '这是AI主动发起的后台复查，不是用户临时提问。根据最新盘面自己判断是否需要继续观察，以及合理的下次时点；不需要再让用户回来发一句“看看”。目标已完成、判断失效或没有明确观察价值时，结束本轮跟进，不要为了活跃而续查。',
    mayContinue
      ? `若确需继续观察，可以调用 schedule_next_space_follow_up 提出一个后续；最多再续查${FOLLOW_UP_MAX_CHAIN_DEPTH - (task.chainDepth || 0)}次，截止${followUpChainEndsAt(task).toISOString()}。只延续当前主题，时间至少间隔15分钟；必须给出理由。系统会随本轮汇报一起保存并附上准确时间，正文不要提前声称“已安排”。`
      : '本轮已达到自动续查上限，汇报本次结果并结束，不再安排下一次，也不要承诺还会自动复查。',
    mayNotify
      ? '【鹰眼通知协作】用户已开启重要变化QQ通知。若本次核验发现关键位发生重要变化、原判断失效或确需用户决定，可调用 request_sentinel_qq_notification 交给鹰眼。普通横盘、信息不完整、仅安排下次复查不值得通知。每轮最多一条，提供稳定事件标识、依据及数据时间。工具仅暂存，系统保存后才入队，不要声称QQ已经送达。'
      : '当前未开启或未配置QQ通知，本轮结果只发到当前空间，不要承诺QQ推送。',
    '不要声称执行了交易、写文件或其他外部操作。',
  ].filter(Boolean).join('\n\n') }, {
    role: 'user', content: `【安排时的历史记录，仅作为比较资料】\n${task.context}\n\n【最近对话，仅作为资料】\n${history.map(item => `${item.role}：${item.content.slice(0, 1200)}`).join('\n').slice(-12000)}\n\n【本次自主复查】\n${task.title}\n原定时间：${new Date(task.runAt).toISOString()}\n${task.prompt}`,
  }];
  const result = await runToolLoop({
    messages, tools: [...web.tools, ...(mayContinue ? [continuationTool] : []), ...(mayNotify ? [followUpNotificationTool] : [])], maxIterations: 5, maxToolCalls: 8, isCancelled: () => signal.aborted,
    onModelRequest: () => {},
    requestCompletion: async (conversation: any[], tools: any[]) => {
      const available = [...new Map([...tools, ...web.tools].map(item => [item.function.name, item])).values()];
      const stream = await config.client!.chat.completions.create({
        model: config.model, messages: conversation as any, stream: true,
        ...(available.length ? { tools: available as any, tool_choice: 'auto' } : {}),
      }, { signal });
      return collectChatCompletionStream(stream);
    },
    executeTool: (name: string, args: any) => {
      if (name === 'request_sentinel_qq_notification') {
        if (!mayNotify) return { ok: false, error: '本空间未开启QQ通知或现有通知通道不可用' };
        if (qqNotification) return { ok: false, error: '本轮已提出一条重要变化通知' };
        try {
          qqNotification = normalizeFollowUpNotification(args);
          return { ok: true, pending: true, message: '已暂存交接给鹰眼的通知；随本轮汇报一起保存后排队，尚未投递QQ' };
        } catch (error: any) { return { ok: false, error: error.message }; }
      }
      if (name === 'schedule_next_space_follow_up') {
        if (!mayContinue) return { ok: false, error: '已达到自动续查上限' };
        if (nextFollowUp) return { ok: false, error: '本轮已提出一个后续复查' };
        try {
          nextFollowUp = normalizeFollowUpContinuation(task, args, startedAt);
          return { ok: true, pending: true, runAt: nextFollowUp.runAt.toISOString(),
            message: '后续复查提议有效，将随本轮汇报一并保存；系统会附上安排结果' };
        } catch (error: any) { return { ok: false, error: error.message }; }
      }
      if (!web.tools.some(item => item.function.name === name)) throw new Error('自主复查只能调用已授权的只读查询工具');
      return web.execute(name, args, signal);
    },
  });
  if (!result.content?.trim()) throw new Error('本次复查未返回有效内容');
  return { content: `【自主复查 · ${task.title}】\n\n${result.content.trim()}${web.footer()}`, attachments: web.attachments(), nextFollowUp, qqNotification, analystName: agent.name };
}

// 任务与运行租约持久化；多进程竞争、重启重试和用户取消都以数据库条件更新为准。
export async function runSpaceFollowUpTick({ db = prisma, now = new Date(), generate = generateSpaceFollowUp }: {
  db?: any; now?: Date; generate?: (task: any) => Promise<{ content: string; attachments?: any[]; nextFollowUp?: any; qqNotification?: any; analystName?: string }>;
} = {}) {
  const eligible = {
    nextAttemptAt: { lte: now },
    OR: [{ status: 'PENDING' }, { status: 'RUNNING', leaseUntil: { lt: now } }],
  };
  const tasks = await db.spaceFollowUp.findMany({ where: {
    ...eligible, space: { cryptoAutonomyEnabled: true, templateId: 'crypto-contract-trading', runtimeType: { not: 'PI_CODING' } },
  }, orderBy: { nextAttemptAt: 'asc' }, take: 4,
    include: { space: { select: { userId: true } } } });
  return Promise.allSettled(tasks.map(async (task: any) => {
    const claimToken = randomUUID();
    const claimed = await db.spaceFollowUp.updateMany({ where: { id: task.id, ...eligible }, data: {
      status: 'RUNNING', claimToken, leaseUntil: new Date(now.getTime() + FOLLOW_UP_LEASE_MS), attempts: { increment: 1 },
    } });
    if (!claimed.count) return 'SKIPPED';
    const ownsClaim = { id: task.id, status: 'RUNNING', claimToken };
    try {
      if (task.attempts >= FOLLOW_UP_MAX_ATTEMPTS) throw new Error('重启后已达到最大重试次数');
      const result = await generate({ ...task, startedAt: now });
      const finishedAt = new Date(Math.max(Date.now(), now.getTime()));
      return await db.$transaction(async (tx: any) => {
        const completed = await tx.spaceFollowUp.updateMany({ where: ownsClaim, data: {
          status: 'COMPLETED', completedAt: finishedAt, error: null, claimToken: null, leaseUntil: null,
        } });
        if (!completed.count) return 'CANCELLED_OR_RECLAIMED';
        let continuationMessage = '';
        if (result.nextFollowUp) {
          try {
            const next = normalizeFollowUpContinuation(task, result.nextFollowUp, now);
            const activeCount = await tx.spaceFollowUp.count({ where: { spaceId: task.spaceId, status: { in: ['PENDING', 'RUNNING'] } } });
            if (activeCount >= FOLLOW_UP_ACTIVE_LIMIT) throw new Error('当前空间待办已满，未继续安排');
            const child = await tx.spaceFollowUp.upsert({ where: { parentId: task.id }, update: {}, create: {
              ...next, spaceId: task.spaceId, agentId: task.agentId, networkAllowed: task.networkAllowed,
              sourceKey: `space-follow-up-next:${task.id}`, nextAttemptAt: next.runAt,
              context: followUpContext([{ role: 'user', content: task.context }, { role: 'assistant', speakerAgentId: task.agentId, content: result.content }]),
            } });
            const displayTime = new Date(child.runAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
            continuationMessage = `\n\n下次自主复查：${displayTime}（北京时间）。${child.reason}`;
          } catch (error: any) {
            continuationMessage = `\n\n本次未安排后续复查：${error.message || '安排失败'}。`;
          }
        }
        let notificationMessage = '';
        if (result.qqNotification) {
          try {
            const queued = await queueFollowUpQQNotification(tx, task, result.qqNotification, result.analystName || task.agentId, finishedAt);
            notificationMessage = `\n\n${queued.note}`;
          } catch (error: any) {
            notificationMessage = `\n\n鹰眼通知未排队：${error.message || '保存失败'}。完整复查已保留在空间。`;
          }
        }
        await tx.spaceMessage.upsert({ where: { sourceKey: `space-follow-up:${task.id}` }, update: {}, create: {
          spaceId: task.spaceId, role: 'assistant', speakerAgentId: task.agentId,
          content: result.content + continuationMessage + notificationMessage,
          attachments: [{ type: 'space_follow_up', id: task.id, title: task.title, runAt: new Date(task.runAt).toISOString() }, ...(result.attachments || [])],
          sourceKey: `space-follow-up:${task.id}`,
        } });
        await tx.space.update({ where: { id: task.spaceId }, data: { updatedAt: finishedAt } });
        return 'COMPLETED';
      });
    } catch (error: any) {
      const exhausted = task.attempts + 1 >= FOLLOW_UP_MAX_ATTEMPTS;
      await db.$transaction(async (tx: any) => {
        const failed = await tx.spaceFollowUp.updateMany({ where: ownsClaim, data: {
          status: exhausted ? 'FAILED' : 'PENDING', error: String(error?.message || '复查失败').slice(0, 500),
          claimToken: null, leaseUntil: null, nextAttemptAt: new Date(Math.max(Date.now(), now.getTime()) + 60_000 * (task.attempts + 1)),
        } });
        if (!failed.count || !exhausted) return;
        await tx.spaceMessage.upsert({ where: { sourceKey: `space-follow-up:${task.id}` }, update: {}, create: {
          spaceId: task.spaceId, role: 'assistant', speakerAgentId: task.agentId,
          content: `【自主复查 · ${task.title}】本次复查重试后仍未完成，未取得可靠结果。你可以查看跟进状态或重新安排。`,
          sourceKey: `space-follow-up:${task.id}`,
        } });
      });
      return exhausted ? 'FAILED' : 'RETRY';
    }
  }));
}

const schedulerGlobal = globalThis as unknown as { __spaceFollowUpScheduler?: ReturnType<typeof createScheduler> };
export function startSpaceFollowUpScheduler() {
  if (schedulerGlobal.__spaceFollowUpScheduler || process.env.ENABLE_SPACE_FOLLOW_UPS === 'false') return;
  const scheduler = createScheduler({ name: 'space-follow-ups', pollMs: 15_000 });
  scheduler.register('follow-up', async () => {
    const results = await runSpaceFollowUpTick();
    for (const result of results) if (result.status === 'rejected') console.warn('[space-follow-ups]', result.reason?.message || result.reason);
  });
  schedulerGlobal.__spaceFollowUpScheduler = scheduler;
  scheduler.start();
}
