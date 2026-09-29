import prisma from '@/app/api/_lib/db';
import { agentMemoryContext } from '@/lib/agent-memory-policy.mjs';

export async function loadAgentMemoryContext(options: {
  userId: string;
  agentId?: string | null;
  query: string;
}) {
  if (!options.agentId) return '';
  const agent = await prisma.agent.findFirst({
    where: { id: options.agentId },
    select: { id: true, agentType: true },
  });
  if (!agent) return '';
  const [rules, experiences] = await Promise.all([
    agent.agentType === 'EMPLOYEE'
      ? prisma.agentMemoryRule.findMany({
          where: { userId: options.userId, agentId: options.agentId, status: 'ACTIVE' },
          orderBy: { updatedAt: 'desc' },
          take: 60,
        })
      : Promise.resolve([]),
    prisma.agentExperience.findMany({
      where: { userId: options.userId, agentId: options.agentId, outcome: 'ACCEPTED' },
      orderBy: { updatedAt: 'desc' },
      take: 30,
      select: { title: true, summary: true, outcome: true, createdAt: true },
    }),
  ]);
  return agentMemoryContext({ rules, experiences, query: options.query });
}
