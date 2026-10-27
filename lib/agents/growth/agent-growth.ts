import prisma from '@/app/api/_lib/db';
import { randomUUID } from 'node:crypto';

export type AgentGrowthScope = 'PERSONAL' | 'SPACE';

const GROWTH_EVENT_TYPES = ['OBSERVATION', 'BELIEF', 'REVISION', 'REFLECTION', 'REFUSAL', 'DIARY'] as const;

export const agentGrowthToolSchema = {
  type: 'function',
  function: {
    name: 'growth_commit',
    description: '记录一次真正值得保留的 Agent 成长经历。只有形成观察、判断、反思、修正、拒绝或日记内容时使用；普通聊天不要调用。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'title', 'content'],
      properties: {
        type: { type: 'string', enum: [...GROWTH_EVENT_TYPES], description: '成长事件类型。' },
        title: { type: 'string', maxLength: 160, description: '这次经历的简短标题。' },
        content: { type: 'string', maxLength: 1200, description: '这次经历对自己的实际影响，不能只复述用户原话。' },
        previousBelief: { type: 'string', maxLength: 500, description: '如果是 REVISION，可填写之前的判断。' },
      },
    },
  },
};

export interface AppendAgentGrowthEventInput {
  userId: string;
  agentId: string;
  type: string;
  sourceType?: string;
  sourceId?: string;
  eventKey: string;
  spaceId?: string | null;
  payload: Record<string, unknown>;
}

/**
 * 成长历史的唯一写入口。重复 eventKey 视为同一事件，保证后台重试不会重复记录。
 */
export async function appendAgentGrowthEvent(input: AppendAgentGrowthEventInput) {
  const scope: AgentGrowthScope = input.spaceId ? 'SPACE' : 'PERSONAL';
  return prisma.agentGrowthEvent.upsert({
    where: { eventKey: input.eventKey },
    create: {
      userId: input.userId,
      agentId: input.agentId,
      spaceId: input.spaceId || null,
      scope,
      type: input.type,
      sourceType: input.sourceType || 'CHAT',
      sourceId: input.sourceId || null,
      eventKey: input.eventKey,
      payload: input.payload as any,
    },
    update: {},
  });
}

export function createAgentGrowthTools({ userId, agentId, spaceId }: { userId: string; agentId: string; spaceId?: string | null }) {
  const scope = spaceId ? '当前空间' : '个人';
  return {
    tools: [agentGrowthToolSchema],
    owns(name: string) { return name === 'growth_commit'; },
    async execute(name: string, args: Record<string, unknown>) {
      if (name !== 'growth_commit') return { ok: false, error: '未知成长工具' };
      const type = String(args?.type || '').trim().toUpperCase();
      if (!GROWTH_EVENT_TYPES.includes(type as (typeof GROWTH_EVENT_TYPES)[number])) {
        return { ok: false, error: '成长事件类型无效' };
      }
      const title = String(args?.title || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      const content = String(args?.content || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
      if (!title || !content) return { ok: false, error: '成长记录需要标题和具体内容' };
      const event = await appendAgentGrowthEvent({
        userId,
        agentId,
        spaceId,
        type,
        sourceType: 'CHAT',
        sourceId: randomUUID(),
        eventKey: `chat-growth:${userId}:${agentId}:${spaceId || 'personal'}:${randomUUID()}`,
        payload: {
          title,
          content,
          ...(args?.previousBelief ? { previousBelief: String(args.previousBelief).trim().slice(0, 500) } : {}),
        },
      });
      return { ok: true, scope, type, eventId: event.id, message: '成长经历已记录' };
    },
  };
}

export function formatAgentGrowthContext(events: Array<{
  type: string;
  sourceType: string;
  payload: unknown;
  createdAt: Date | string;
}>, query = '') {
  const terms = String(query || '').toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
  const scored = events.filter(event => {
    const payload = event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {};
    // 旧版阅读流水和任务验收记录保留在历史中，不再作为认知变化召回。
    return event.type !== 'STUDY' && !(event.sourceType === 'TASK' && event.type === 'REFLECTION' && payload.outcome === 'ACCEPTED' && payload.taskId);
  }).map((event, index) => {
    const payload = event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {};
    const text = `${payload.title || ''} ${payload.content || ''} ${payload.summary || ''} ${payload.thoughts || ''}`.toLocaleLowerCase();
    let score = 1;
    if (terms.length) {
      score = 0;
      for (const term of terms) {
        if (text.includes(term)) score += 1;
      }
    }
    return { event, payload, score, index };
  }).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 8);
  if (!scored.length) return '';

  const lines = scored.map(({ event, payload }) => {
    const title = String(payload.title || payload.topic || event.type).replace(/\s+/g, ' ').trim().slice(0, 160);
    const summary = String(payload.summary || payload.thoughts || payload.content || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    const date = new Date(event.createdAt).toISOString().slice(0, 10);
    return `- [${event.type} · ${date}] ${title}${summary ? `：${summary}` : ''}`;
  });
  return [
    '【当前 Agent 活动中的判断与反思】',
    ...lines,
    '这些是当时的判断与反思，不是已验证的能力或用户约定。涉及用户个人信息时，仍需用户确认后才能写入个人记忆。',
  ].join('\n');
}

export async function loadAgentGrowthContext({
  userId,
  agentId,
  spaceId,
  query,
}: { userId: string; agentId: string; spaceId?: string | null; query?: string }) {
  const db: any = (prisma as any)?.default || prisma;
  if (!db?.agentGrowthEvent?.findMany) return '';
  const where = spaceId
    ? { userId, agentId, OR: [{ scope: 'PERSONAL' }, { scope: 'SPACE', spaceId }] }
    : { userId, agentId, scope: 'PERSONAL' };
  try {
    const events = await db.agentGrowthEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { type: true, sourceType: true, payload: true, createdAt: true },
    });
    return formatAgentGrowthContext(events, query);
  } catch (error) {
    console.warn('[AgentGrowth] Failed to load growth context:', error);
    return '';
  }
}
