import { memoryCandidateWhere, memoryArchiveCandidateWhere, recallExperiences, memoryArchiveDateFilter, memoryDateQuery } from '@/lib/memory/memory-recall.mjs';
import { recallOriginalDetails } from '@/lib/memory/memory-store';
import prisma from '@/app/api/_lib/db';
import { agentMemoryContext, selectAgentMemory, agentMemoryRuleWhere } from '@/lib/agents/memory/agent-memory-policy.mjs';
import { personalMemoryContext } from '@/lib/agents/memory/agent-personal-memory.mjs';
import { loadAgentGrowthContext } from '@/lib/agents/growth/agent-growth';

export async function loadAgentMemoryContext(options: {
  userId: string;
  agentId?: string | null;
  query: string;
  spaceId?: string | null;
  taskId?: string | null;
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
  const [memories, rules, experiences, chatArchives, growth] = await Promise.all([
    prisma.agentMemoryItem.findMany({
      where: { userId: options.userId, agentId: options.agentId, status: 'ACTIVE', trustStatus: 'VERIFIED', category: { not: 'skill' }, AND: [memoryCandidateWhere(options.query, ['category', 'content'])] },
      orderBy: { updatedAt: 'desc' }, take: 60,
    }),
    agent?.agentType === 'EMPLOYEE'
      ? prisma.agentMemoryRule.findMany({
          where: { userId: options.userId, agentId: options.agentId, status: 'ACTIVE', AND: [agentMemoryRuleWhere(options), memoryCandidateWhere(options.query, ['title', 'instruction'])] },
          orderBy: { updatedAt: 'desc' },
          take: 60,
        })
      : Promise.resolve([]),
    prisma.agentExperience.findMany({
      where: { userId: options.userId, agentId: options.agentId, outcome: 'ACCEPTED', status: 'ACTIVE', sourceType: { not: 'CHAT' }, ...experienceScope, AND: [memoryCandidateWhere(options.query, ['title', 'summary'])] },
      orderBy: { updatedAt: 'desc' }, take: 120,
      select: { id: true, title: true, summary: true, outcome: true, spaceId: true, sourceType: true, createdAt: true, tags: true, memorySegments: true, status: true },
    }),
    options.spaceId ? Promise.resolve([]) : prisma.agentExperience.findMany({
      where: { userId: options.userId, agentId: options.agentId, outcome: 'ACCEPTED', status: 'ACTIVE', sourceType: 'CHAT', spaceId: null,
        ...(options.conversationId ? { taskId: { startsWith: `chat:${options.conversationId}:` } } : {}),
        AND: [memoryArchiveCandidateWhere(options.query, ['title', 'summary']), ...(memoryDateQuery(options.query) ? [memoryArchiveDateFilter(options.query, 'agent')] : [])] },
      orderBy: memoryDateQuery(options.query) ? { createdAt: 'asc' } : { updatedAt: 'desc' }, take: 120,
      select: { id: true, title: true, summary: true, outcome: true, spaceId: true, sourceType: true, createdAt: true, tags: true, memorySegments: true, status: true },
    }),
    loadAgentGrowthContext({ userId: options.userId, agentId: options.agentId, spaceId: options.spaceId, query: options.query }),
  ]);
  const chats = recallExperiences(chatArchives, options.query);
  const other = experiences.filter(item => item.sourceType !== 'CHAT');
  const selected = selectAgentMemory({ rules, experiences: other, query: options.query, spaceId: options.spaceId, taskId: options.taskId });
  let originalContext = '';
  if (!options.spaceId) {
    try { originalContext = await recallOriginalDetails({ userId: options.userId, kind: 'agent', agentId: options.agentId, conversationId: options.conversationId }, options.query, chats.items, options.recentMessageIds); }
    catch { originalContext = '【历史原文查证】本轮未能读取原文；只可引用摘要，不得编造原话。'; }
  }
  const selectedIds = [...chats.items, ...selected.experiences].map(item => item.id);
  return [selectedIds.length ? `可引用的经历证据 ID：${selectedIds.join(', ')}` : '', personalMemoryContext(memories, options.query), chats.context, originalContext, agentMemoryContext({ rules, experiences: other, query: options.query, spaceId: options.spaceId, taskId: options.taskId }), growth].filter(Boolean).join('\n\n');
}
