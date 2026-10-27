import prisma from '@/app/api/_lib/db';
import { agentMemoryContext } from '@/lib/agents/memory/agent-memory-policy.mjs';
import { personalMemoryContext } from '@/lib/agents/memory/agent-personal-memory.mjs';
import { loadAgentGrowthContext } from '@/lib/agents/growth/agent-growth';

export async function loadAgentMemoryContext(options: {
  userId: string;
  agentId?: string | null;
  query: string;
  spaceId?: string | null;
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
      where: { userId: options.userId, agentId: options.agentId, status: 'ACTIVE', category: { not: 'skill' } },
      orderBy: { updatedAt: 'desc' }, take: 60,
    }),
    agent?.agentType === 'EMPLOYEE'
      ? prisma.agentMemoryRule.findMany({
          where: { userId: options.userId, agentId: options.agentId, status: 'ACTIVE' },
          orderBy: { updatedAt: 'desc' },
          take: 60,
        })
      : Promise.resolve([]),
    prisma.agentExperience.findMany({
      where: { userId: options.userId, agentId: options.agentId, outcome: 'ACCEPTED', status: 'ACTIVE', ...experienceScope },
      orderBy: { updatedAt: 'desc' },
      take: 30,
      select: { id: true, title: true, summary: true, outcome: true, spaceId: true, sourceType: true, createdAt: true },
    }),
    loadAgentGrowthContext({ userId: options.userId, agentId: options.agentId, spaceId: options.spaceId, query: options.query }),
  ]);
  return [experiences.length ? `可引用的经历证据 ID：${experiences.map(e => e.id).join(', ')}` : '', personalMemoryContext(memories, options.query), agentMemoryContext({ rules, experiences, query: options.query }), growth].filter(Boolean).join('\n\n');
}
