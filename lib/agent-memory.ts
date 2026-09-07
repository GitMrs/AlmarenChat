import prisma from '@/app/api/_lib/db';
import { agentMemoryContext } from '@/lib/agent-memory-policy.mjs';

export async function loadAgentMemoryContext(options: {
  userId: string;
  agentId?: string | null;
  query: string;
}) {
  if (!options.agentId) return '';
  const [rules, experiences] = await Promise.all([
    prisma.agentMemoryRule.findMany({
      where: { userId: options.userId, agentId: options.agentId, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
      take: 60,
    }),
    prisma.agentExperience.findMany({
      where: { userId: options.userId, agentId: options.agentId, outcome: 'ACCEPTED' },
      orderBy: { updatedAt: 'desc' },
      take: 40,
    }),
  ]);
  return agentMemoryContext({ rules, experiences, query: options.query });
}
