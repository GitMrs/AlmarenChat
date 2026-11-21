import { createHash, randomUUID } from 'node:crypto';
import { followUpWatchSchema } from './follow-up-watch.mjs';
import prisma from '@/app/api/_lib/db';
import { getSpaceForUser, SPACE_COORDINATOR } from '@/app/api/_lib/spaces';
import { FOLLOW_UP_ACTIVE_LIMIT, FOLLOW_UP_CHAIN_WINDOW_MS, FOLLOW_UP_DEFAULT_MAX_CONTINUATIONS, followUpContext, isExplicitFollowUpRequest, normalizeFollowUp, supportsSpaceFollowUps } from './follow-up-policy.mjs';

const tool = (name: string, description: string, properties: object, required: string[] = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', additionalProperties: false, properties, required } },
});

export function createSpaceFollowUpTools({ userId, spaceId, agentId, sourceMessageId, history, networkAllowed, userMessage, workId }: {
  userId: string;
  spaceId: string;
  agentId: string;
  sourceMessageId: string;
  history: Array<{ role?: string; content?: string | null; speakerAgentId?: string | null }>;
  networkAllowed: boolean;
  userMessage?: string;
  workId?: string;
}) {
  const maySchedule = isExplicitFollowUpRequest(userMessage ?? [...history].reverse().find(message => message.role === 'user')?.content);
  const tools = [
    tool('schedule_space_follow_up', '安排一次未来的只读复查，到时由当前成员读取最新数据、结合本次判断主动回到当前空间汇报。仅保存成功后才能承诺已安排。', {
      title: { type: 'string', maxLength: 100, description: '如 BTC 21点收线复查' },
      prompt: { type: 'string', maxLength: 4000, description: '完整复查目标，包含本次判断、比较基准、关键位置和需要验证的变化。只查询和汇报，不执行外部写操作。' },
      runAt: { type: 'string', description: '未来7天内的ISO日期时间，必须包含时区，如2026-11-14T21:00:00+08:00。' },
      watchConditions: followUpWatchSchema,
      workId: { type: 'string', description: '可选，关联用户指定的本空间成果ID；当前已选择成果时默认关联它，不可擅自改为其他成果。' },
    }, ['title', 'prompt', 'runAt']),
    tool('list_space_follow_ups', '查看当前空间已安排、执行中及近期完成的自主跟进，包含任务ID、时间和状态。', {}),
    tool('cancel_space_follow_up', '取消当前空间指定的自主跟进。取消后不会再发布该任务的结果。', {
      id: { type: 'string', description: 'list_space_follow_ups 返回的任务ID' },
    }, ['id']),
  ].filter(item => maySchedule || item.function.name !== 'schedule_space_follow_up');
  return {
    tools,
    guidance: maySchedule
      ? '本轮用户明确表达了后续跟进意图。先用 list_space_follow_ups 核对同主题的待复查/执行中任务；已有则告知实际时间，不重复安排。没有对应任务且观察目标可从对话合理确定时，选择未来时点并调用 schedule_space_follow_up 保存首次复查，不要停留在建议时间。仅保存成功才能说已安排；目标确实不明时先澄清。'
      : '本轮是用户临时提问，未授予后续跟进权限。请只回答当前问题；本轮不提供安排复查的工具，不要承诺自动再看。',
    owns(name: string) { return tools.some(item => item.function.name === name); },
    async execute(name: string, args: Record<string, unknown>) {
      try {
        const space = await getSpaceForUser(spaceId, userId);
        if (!space) return { ok: false, error: '空间不存在或无权访问' };
        if (!supportsSpaceFollowUps(space)) {
          return { ok: false, error: '当前空间运行模式不支持自主跟进' };
        }
        if (agentId !== SPACE_COORDINATOR.id && !space.members.some(member => member.agentId === agentId)) {
          return { ok: false, error: '当前成员已不在此空间' };
        }
        if (name === 'list_space_follow_ups') {
          const tasks = await prisma.spaceFollowUp.findMany({
            where: { spaceId, ...(workId ? { workId } : {}) }, orderBy: { createdAt: 'desc' }, take: 20,
            select: { id: true, title: true, agentId: true, runAt: true, status: true, error: true, chainDepth: true, maxChainDepth: true, workId: true, workTitle: true, watchConditions: true, watchTriggeredAt: true },
          });
          return { ok: true, tasks, maxContinuations: space.followUpMaxContinuations, schedulingAllowed: maySchedule,
            nextStep: maySchedule
              ? '核对是否已有同主题的待复查或执行中任务；有则报告实际安排，没有且对话能确定观察目标时，调用 schedule_space_follow_up 保存首次复查。仅查询列表不代表已安排。'
              : '本轮仅查询任务状态；没有任务时如实说明，不自行创建。' };
        }
        if (name === 'cancel_space_follow_up') {
          const result = await prisma.spaceFollowUp.updateMany({
            where: { id: String(args.id || ''), spaceId, ...(workId ? { workId } : {}), status: { in: ['PENDING', 'RUNNING'] } },
            data: { status: 'CANCELLED', claimToken: null, leaseUntil: null },
          });
          return { ok: result.count > 0, message: result.count ? '已取消跟进' : '未找到可取消的跟进' };
        }
        if (name !== 'schedule_space_follow_up') return { ok: false, error: '未知跟进工具' };
        if (!maySchedule) return { ok: false, error: '本轮只是临时提问，未要求后续跟进' };
        if (!space.followUpEnabled) return { ok: false, error: '当前空间自主跟进已关闭，请先在对话或跟进记录中开启' };
        if (process.env.ENABLE_SPACE_FOLLOW_UPS === 'false') return { ok: false, error: '服务器已关闭自主复查，暂不能安排' };
        const normalized = normalizeFollowUp(args);
        if (normalized.watchConditions && (space.templateId !== 'crypto-contract-trading' || !networkAllowed)) throw new Error('鹰眼条件仅支持已授权联网的合约跟进');
        if (args.workId != null && (typeof args.workId !== 'string' || !args.workId)) throw new Error('成果ID无效');
        if (workId && args.workId && workId !== args.workId) throw new Error('不能切换本轮已选择的成果');
        const targetWorkId = workId || (typeof args.workId === 'string' ? args.workId : null);
        const hash = createHash('sha256').update(`${targetWorkId ? `${targetWorkId}:` : ''}${normalized.runAt.toISOString()}:${normalized.prompt}`).digest('hex').slice(0, 24);
        const sourceKey = `space-follow-up:${spaceId}:${sourceMessageId}:${agentId}:${hash}`;
        const task = await prisma.$transaction(async tx => {
          // 读空间与保存任务之间可能发生关闭开关或移除成员，必须在事务内复核。
          const currentSpace = await tx.space.findFirst({ where: { id: spaceId, userId }, include: { members: true } });
          if (!currentSpace?.followUpEnabled) throw new Error('当前空间自主复查已关闭，未安排跟进');
          if (!supportsSpaceFollowUps(currentSpace)) throw new Error('当前空间不支持自主跟进');
          if (agentId !== SPACE_COORDINATOR.id && !currentSpace.members.some(member => member.agentId === agentId)) throw new Error('当前成员已不在此空间');
          const existing = await tx.spaceFollowUp.findUnique({ where: { sourceKey } });
          if (existing) return existing;
          const work = targetWorkId ? await tx.spaceWork.findFirst({ where: { id: targetWorkId, spaceId },
            select: { id: true, title: true, objective: true, status: true, updatedAt: true } }) : null;
          if (targetWorkId && !work) throw new Error('关联成果不存在或不属于当前空间');
          const activeCount = await tx.spaceFollowUp.count({ where: { spaceId, status: { in: ['PENDING', 'RUNNING'] } } });
          if (activeCount >= FOLLOW_UP_ACTIVE_LIMIT) throw new Error(`当前空间最多同时安排 ${FOLLOW_UP_ACTIVE_LIMIT} 项跟进，请先取消不需要的任务`);
          const source = await tx.spaceMessage.findFirst({ where: { id: sourceMessageId, spaceId }, select: { createdAt: true } });
          const recent = source ? await tx.spaceMessage.findMany({ where: { spaceId, createdAt: { lte: source.createdAt } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 8,
            select: { role: true, content: true, speakerAgentId: true } }) : [];
          return tx.spaceFollowUp.create({ data: {
            id: randomUUID(), spaceId, agentId, sourceKey,
            sourceMessageId, workId: work?.id, workTitle: work?.title,
            domain: currentSpace.templateId === 'crypto-contract-trading' ? 'CRYPTO' : 'GENERAL',
            ...normalized, nextAttemptAt: normalized.runAt,
            rootPrompt: normalized.prompt,
            maxChainDepth: currentSpace.followUpMaxContinuations ?? FOLLOW_UP_DEFAULT_MAX_CONTINUATIONS,
            chainEndsAt: new Date(normalized.runAt.getTime() + FOLLOW_UP_CHAIN_WINDOW_MS),
            context: [followUpContext(recent.length ? recent.reverse() : history), work ? `【安排时的成果状态】${JSON.stringify(work)}` : ''].filter(Boolean).join('\n\n'), networkAllowed,
          } });
        });
        return { ok: true, id: task.id, title: task.title, runAt: task.runAt.toISOString(), status: task.status,
          watchConditions: task.watchConditions,
          networkAllowed: task.networkAllowed, maxChainDepth: task.maxChainDepth, chainEndsAt: task.chainEndsAt?.toISOString(),
          workId: task.workId, workTitle: task.workTitle,
          message: '已保存首次复查，到点在本空间主动汇报；自动续查额度不含首次，以 maxChainDepth 为准' };
      } catch (error: any) {
        return { ok: false, error: error?.message || '跟进安排失败' };
      }
    },
  };
}
