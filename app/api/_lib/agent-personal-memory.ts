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
}) {
  const space = await prisma.space.findFirst({
    where: { id: options.spaceId, userId: options.userId }, include: { members: true },
  });
  if (!space) return;
  const memberIds = new Set(space.members.map(member => member.agentId));
  const entries = options.entries.filter(entry => memberIds.has(entry.agentId));
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
    }
  });
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
