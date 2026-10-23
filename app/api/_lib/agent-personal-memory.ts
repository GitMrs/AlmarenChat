import prisma from '@/app/api/_lib/db';
import { resolveAgent } from '@/app/api/_lib/spaces';
import { buildSpaceExperience } from '@/lib/agents/memory/agent-personal-memory.mjs';

export async function requireAgentMemoryAccess(userId: string, agentId: string) {
  const agent = await resolveAgent(agentId, userId);
  if (!agent || agent.id === 'space-coordinator') throw new Error('Agent not found');
  return agent;
}

export async function recordSpaceAgentExperiences(options: {
  userId: string; spaceId: string; sourceType: string; sourceId: string;
  topic: string; summary: string; entries: Array<{ agentId: string; agentName?: string; content: string }>;
  extraAgentIds?: string[];
}) {
  const space = await prisma.space.findFirst({
    where: { id: options.spaceId, userId: options.userId }, include: { members: true },
  });
  if (!space) return 0;
  const memberIds = new Set([...space.members.map(member => member.agentId), ...(options.extraAgentIds || [])]);
  const entries = options.entries.filter(entry => memberIds.has(entry.agentId));
  let recorded = 0;
  await prisma.$transaction(async tx => {
    for (const agentId of new Set(entries.map(entry => entry.agentId))) {
      const episode = buildSpaceExperience({ ...options, entries, agentId });
      if (!episode) continue;
      const existing = await tx.agentExperience.findUnique({ where: { userId_agentId_taskId: { userId: options.userId, agentId, taskId: episode.taskId } } });
      await tx.agentExperience.upsert({
        where: { userId_agentId_taskId: { userId: options.userId, agentId, taskId: episode.taskId } },
        create: { ...episode, userId: options.userId, agentId, spaceId: options.spaceId, outcome: 'ACCEPTED' },
        update: { title: episode.title, ...(!existing?.edited ? { summary: episode.summary } : {}) },
      });
      recorded += 1;
    }
  });
  return recorded;
}

const GAME_LABELS: Record<string, string> = {
  gomoku: '五子棋',
  undercover: '谁是卧底',
  turtlesoup: '海龟汤',
  live: 'AI 聊天室',
};

type GameResult = 'win' | 'loss' | 'draw';

/**
 * 按「同一天 + 同一游戏 + 同一角色」合并成一条游戏经历：
 * 计数累加，只保留最近一局，避免一局一条把记忆窗口刷满。
 */
export async function recordGameExperienceRollup(options: {
  userId: string; spaceId: string; gameType: string; date: string; sessionId: string;
  entries: Array<{ agentId: string; agentName?: string; content: string; result?: GameResult }>;
  extraAgentIds?: string[];
}) {
  const space = await prisma.space.findFirst({
    where: { id: options.spaceId, userId: options.userId }, include: { members: true },
  });
  if (!space) return 0;
  const allowed = new Set([...space.members.map(member => member.agentId), ...(options.extraAgentIds || [])]);
  const label = GAME_LABELS[options.gameType] || '空间游戏';
  const taskId = `game:${options.spaceId}:${options.gameType}-${options.date}`;

  const byAgent = new Map<string, typeof options.entries[number]>();
  for (const entry of options.entries) {
    if (allowed.has(entry.agentId)) byAgent.set(entry.agentId, entry);
  }

  let recorded = 0;
  await prisma.$transaction(async tx => {
    for (const [agentId, entry] of byAgent) {
      const existing = await tx.agentExperience.findUnique({
        where: { userId_agentId_taskId: { userId: options.userId, agentId, taskId } },
      });
      const previous = existing?.tags && typeof existing.tags === 'object' && !Array.isArray(existing.tags)
        ? existing.tags as Record<string, unknown>
        : {};
      const sessionIds = Array.isArray(previous.sessionIds)
        ? previous.sessionIds.filter((value): value is string => typeof value === 'string')
        : [];
      if (sessionIds.includes(options.sessionId)) continue;
      sessionIds.push(options.sessionId);
      const games = Number(previous.games || 0) + 1;
      const wins = Number(previous.wins || 0) + (entry.result === 'win' ? 1 : 0);
      const losses = Number(previous.losses || 0) + (entry.result === 'loss' ? 1 : 0);
      const draws = Number(previous.draws || 0) + (entry.result === 'draw' ? 1 : 0);
      const tags = {
        ...previous,
        rollup: 'game',
        gameType: options.gameType,
        date: options.date,
        sessionIds,
        games, wins, losses, draws,
        last: entry.content.slice(0, 300),
        lastAt: new Date().toISOString(),
      };
      const summary = [
        `我参与了空间活动：${label}（${options.date}）。`,
        entry.result
          ? `今天共 ${games} 局：${wins} 胜 ${losses} 负 ${draws} 平。`
          : `今天共参与 ${games} 局。`,
        `最近一局：${entry.content}`,
        '这是当时的空间经历；游戏身份只在该局适用，空间规则不得推广到其他场景。',
      ].join('\n');

      await tx.agentExperience.upsert({
        where: { userId_agentId_taskId: { userId: options.userId, agentId, taskId } },
        create: {
          userId: options.userId, agentId, spaceId: options.spaceId, taskId,
          title: `${label} · ${options.date}`, summary, outcome: 'ACCEPTED', sourceType: 'GAME', tags,
        },
        update: {
          title: `${label} · ${options.date}`, tags,
          ...(!existing?.edited ? { summary } : {}),
        },
      });
      recorded += 1;
    }
  });
  return recorded;
}

export async function archiveAgentChat(userId: string, agentId: string, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, userId, agentId, kind: 'AGENT', agentMode: 'MAIN' }, select: { id: true } });
  if (!conversation) return;
  const prefix = `chat:${conversationId}:`;
  const previous = await prisma.agentExperience.findFirst({ where: { userId, agentId, sourceType: 'CHAT', taskId: { startsWith: prefix } }, orderBy: [{ createdAt: 'desc' }, { taskId: 'desc' }] });
  const tags = Array.isArray(previous?.tags) ? previous.tags.map(String) : [];
  const throughId = tags.find(tag => tag.startsWith('through-id:'))?.slice(11);
  const throughTime = tags.find(tag => tag.startsWith('through-time:'))?.slice(13);
  const messages = await prisma.message.findMany({
    where: { conversationId, role: { in: ['user', 'assistant'] }, ...(throughTime && throughId ? { OR: [{ createdAt: { gt: new Date(throughTime) } }, { createdAt: new Date(throughTime), id: { gt: throughId } }] } : {}) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 64,
  });
  if (messages.length < 64) return;
  const batch = messages.slice(0, 48);
  const last = batch[batch.length - 1];
  const title = `与用户的对话：${(batch.find(item => item.role === 'user')?.content || '').replace(/\s+/g, ' ').slice(0, 60)}`;
  const introduction = '这是当时的对话记录；用户陈述与我的回应需要区分，回应中的建议和推测不等于已发生的事实。';
  const snippetLimit = Math.floor((2_000 - introduction.length) / batch.length) - 7;
  const summary = [introduction,
    ...batch.map(item => `${item.role === 'user' ? '用户当时说' : '我当时回应'}：${item.content.replace(/\s+/g, ' ').slice(0, snippetLimit)}`),
  ].join('\n');
  await prisma.agentExperience.upsert({
    where: { userId_agentId_taskId: { userId, agentId, taskId: `${prefix}${last.id}` } },
    create: { userId, agentId, taskId: `${prefix}${last.id}`, title, summary, sourceType: 'CHAT', outcome: 'ACCEPTED', createdAt: last.createdAt, tags: [`through-id:${last.id}`, `through-time:${last.createdAt.toISOString()}`, ...batch.map(item => `message:${item.id}`)] },
    update: {},
  });
}
