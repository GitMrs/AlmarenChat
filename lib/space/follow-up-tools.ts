import { createHash, randomUUID } from 'node:crypto';
import prisma from '@/app/api/_lib/db';
import { getSpaceForUser, SPACE_COORDINATOR } from '@/app/api/_lib/spaces';
import { FOLLOW_UP_ACTIVE_LIMIT, FOLLOW_UP_CHAIN_WINDOW_MS, followUpContext, isExplicitFollowUpRequest, normalizeFollowUp } from './follow-up-policy.mjs';

const tool = (name: string, description: string, properties: object, required: string[] = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', additionalProperties: false, properties, required } },
});

export function createSpaceFollowUpTools({ userId, spaceId, agentId, sourceMessageId, history, networkAllowed, userMessage }: {
  userId: string;
  spaceId: string;
  agentId: string;
  sourceMessageId: string;
  history: Array<{ role?: string; content?: string | null; speakerAgentId?: string | null }>;
  networkAllowed: boolean;
  userMessage?: string;
}) {
  const maySchedule = isExplicitFollowUpRequest(userMessage ?? [...history].reverse().find(message => message.role === 'user')?.content);
  const tools = [
    tool('schedule_space_follow_up', '安排一次未来的只读复查，到时由当前成员读取最新数据、结合本次判断主动回到当前空间汇报。仅保存成功后才能承诺已安排。', {
      title: { type: 'string', maxLength: 100, description: '如 BTC 21点收线复查' },
      prompt: { type: 'string', maxLength: 4000, description: '完整复查目标，包含本次判断、比较基准、关键位置和需要验证的变化。只查询和汇报，不执行外部写操作。' },
      runAt: { type: 'string', description: '未来7天内的ISO日期时间，必须包含时区，如2026-11-14T21:00:00+08:00。' },
    }, ['title', 'prompt', 'runAt']),
    tool('list_space_follow_ups', '查看当前空间已安排、执行中及近期完成的自主跟进，包含任务ID、时间和状态。', {}),
    tool('cancel_space_follow_up', '取消当前空间指定的自主跟进。取消后不会再发布该任务的结果。', {
      id: { type: 'string', description: 'list_space_follow_ups 返回的任务ID' },
    }, ['id']),
  ].filter(item => maySchedule || item.function.name !== 'schedule_space_follow_up');
  return {
    tools,
    guidance: maySchedule
      ? '本轮用户明确表达了后续跟进意图，可以使用 schedule_space_follow_up 安排首次复查。'
      : '本轮是用户临时提问，未授予后续跟进权限。请只回答当前问题；本轮不提供安排复查的工具，不要承诺自动再看。',
    owns(name: string) { return tools.some(item => item.function.name === name); },
    async execute(name: string, args: Record<string, unknown>) {
      try {
        const space = await getSpaceForUser(spaceId, userId);
        if (!space) return { ok: false, error: '空间不存在或无权访问' };
        if (space.templateId !== 'crypto-contract-trading' || space.runtimeType === 'PI_CODING') {
          return { ok: false, error: '当前仅合约空间支持自主复查' };
        }
        if (agentId !== SPACE_COORDINATOR.id && !space.members.some(member => member.agentId === agentId)) {
          return { ok: false, error: '当前成员已不在此空间' };
        }
        if (name === 'list_space_follow_ups') {
          const tasks = await prisma.spaceFollowUp.findMany({
            where: { spaceId }, orderBy: { createdAt: 'desc' }, take: 20,
            select: { id: true, title: true, agentId: true, runAt: true, status: true, error: true },
          });
          return { ok: true, tasks };
        }
        if (name === 'cancel_space_follow_up') {
          const result = await prisma.spaceFollowUp.updateMany({
            where: { id: String(args.id || ''), spaceId, status: { in: ['PENDING', 'RUNNING'] } },
            data: { status: 'CANCELLED', claimToken: null, leaseUntil: null },
          });
          return { ok: result.count > 0, message: result.count ? '已取消跟进' : '未找到可取消的跟进' };
        }
        if (name !== 'schedule_space_follow_up') return { ok: false, error: '未知跟进工具' };
        if (!maySchedule) return { ok: false, error: '本轮只是临时提问，未要求后续跟进' };
        if (!space.cryptoAutonomyEnabled) return { ok: false, error: '当前空间自主复查已关闭，请先在作战中心开启' };
        if (process.env.ENABLE_SPACE_FOLLOW_UPS === 'false') return { ok: false, error: '服务器已关闭自主复查，暂不能安排' };
        const normalized = normalizeFollowUp(args);
        const hash = createHash('sha256').update(`${normalized.runAt.toISOString()}:${normalized.prompt}`).digest('hex').slice(0, 24);
        const sourceKey = `space-follow-up:${spaceId}:${sourceMessageId}:${agentId}:${hash}`;
        const task = await prisma.$transaction(async tx => {
          // 读空间与保存任务之间可能发生关闭开关或移除成员，必须在事务内复核。
          const currentSpace = await tx.space.findFirst({ where: { id: spaceId, userId }, include: { members: true } });
          if (!currentSpace?.cryptoAutonomyEnabled) throw new Error('当前空间自主复查已关闭，未安排跟进');
          if (currentSpace.templateId !== 'crypto-contract-trading' || currentSpace.runtimeType === 'PI_CODING') throw new Error('当前空间不支持自主复查');
          if (agentId !== SPACE_COORDINATOR.id && !currentSpace.members.some(member => member.agentId === agentId)) throw new Error('当前成员已不在此空间');
          const existing = await tx.spaceFollowUp.findUnique({ where: { sourceKey } });
          if (existing) return existing;
          const activeCount = await tx.spaceFollowUp.count({ where: { spaceId, status: { in: ['PENDING', 'RUNNING'] } } });
          if (activeCount >= FOLLOW_UP_ACTIVE_LIMIT) throw new Error(`当前空间最多同时安排 ${FOLLOW_UP_ACTIVE_LIMIT} 项跟进，请先取消不需要的任务`);
          return tx.spaceFollowUp.create({ data: {
            id: randomUUID(), spaceId, agentId, sourceKey,
            ...normalized, nextAttemptAt: normalized.runAt,
            chainEndsAt: new Date(normalized.runAt.getTime() + FOLLOW_UP_CHAIN_WINDOW_MS),
            context: followUpContext(history), networkAllowed,
          } });
        });
        return { ok: true, id: task.id, title: task.title, runAt: task.runAt.toISOString(), status: task.status,
          networkAllowed: task.networkAllowed, message: '已保存一次性跟进，到点由当前成员在本空间主动汇报' };
      } catch (error: any) {
        return { ok: false, error: error?.message || '跟进安排失败' };
      }
    },
  };
}
