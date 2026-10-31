import { memoryCandidateWhere, recallExperiences, memoryArchiveDateFilter, memoryDateQuery } from '@/lib/memory/memory-recall.mjs';
import { recallOriginalDetails } from '@/lib/memory/memory-store';
import prisma from '@/app/api/_lib/db';
import { agentMemoryContext, selectAgentMemory } from '@/lib/agents/memory/agent-memory-policy.mjs';
import { personalMemoryContext } from '@/lib/agents/memory/agent-personal-memory.mjs';
import { loadAgentGrowthContext } from '@/lib/agents/growth/agent-growth';

export async function loadAgentMemoryContext(options: {
  userId: string;
  agentId?: string | null;
  query: string;
  spaceId?: string | null;
  conversationId?: string;
  recentMessageIds?: string[];
}) {
  if (!options.agentId) return '';
  const agent = await prisma.agent.findFirst({
    where: { id: options.agentId },
    select: { id: true, agentType: true },
  });
  const experienceScope = options.spaceId
    ? { OR: [{ spaceId: null }, { spaceId: options.spaceId }] }
    : { spaceId: null };
  const [memories, rules, experiences, growth] = await Promise.all([
    prisma.agentMemoryItem.findMany({
      where: { userId: options.userId, agentId: options.agentId, status: 'ACTIVE', category: { not: 'skill' }, AND: [memoryCandidateWhere(options.query, ['category', 'content'])] },
      orderBy: { updatedAt: 'desc' }, take: 60,
    }),
    agent?.agentType === 'EMPLOYEE'
      ? prisma.agentMemoryRule.findMany({
          where: { userId: options.userId, agentId: options.agentId, status: 'ACTIVE', AND: [memoryCandidateWhere(options.query, ['title', 'instruction'])] },
          orderBy: { updatedAt: 'desc' },
          take: 60,
        })
      : Promise.resolve([]),
    prisma.agentExperience.findMany({
      where: { userId: options.userId, agentId: options.agentId, outcome: 'ACCEPTED', status: 'ACTIVE', ...experienceScope, AND: [memoryCandidateWhere(options.query, ['title', 'summary']), ...(memoryDateQuery(options.query) ? [{ OR: [{ sourceType: { not: 'CHAT' } }, memoryArchiveDateFilter(options.query, 'agent')] }] : []), ...(options.conversationId ? [{ OR: [{ sourceType: { not: 'CHAT' } }, { taskId: { startsWith: `chat:${options.conversationId}:` } }] }] : [])] },
      orderBy: memoryDateQuery(options.query) ? { createdAt: 'asc' } : { updatedAt: 'desc' },
      take: 120,
      select: { id: true, title: true, summary: true, outcome: true, spaceId: true, sourceType: true, createdAt: true, tags: true, status: true },
    }),
    loadAgentGrowthContext({ userId: options.userId, agentId: options.agentId, spaceId: options.spaceId, query: options.query }),
  ]);
  const chats = recallExperiences(experiences.filter(item => item.sourceType === 'CHAT'), options.query);
  const other = experiences.filter(item => item.sourceType !== 'CHAT');
  const selected = selectAgentMemory({ rules, experiences: other, query: options.query });
  let originalContext = '';
  if (!options.spaceId) {
    try { originalContext = await recallOriginalDetails({ userId: options.userId, kind: 'agent', agentId: options.agentId, conversationId: options.conversationId }, options.query, chats.items, options.recentMessageIds); }
    catch { originalContext = '【历史原文查证】本轮未能读取原文；只可引用摘要，不得编造原话。'; }
  }
  const selectedIds = [...chats.items, ...selected.experiences].map(item => item.id);
  return [selectedIds.length ? `可引用的经历证据 ID：${selectedIds.join(', ')}` : '', personalMemoryContext(memories, options.query), chats.context, originalContext, agentMemoryContext({ rules, experiences: other, query: options.query }), growth].filter(Boolean).join('\n\n');
}
