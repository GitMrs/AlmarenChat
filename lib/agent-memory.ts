import prisma from '@/app/api/_lib/db';
import { agentMemoryContext } from '@/lib/agent-memory-policy.mjs';

export async function loadAgentMemoryContext(options: {
  userId: string;
  agentId?: string | null;
  query: string;
}) {
  if (!options.agentId) return '';
  const agent = await prisma.agent.findFirst({
    where: { id: options.agentId, agentType: 'EMPLOYEE' },
    select: { id: true },
  });
  if (!agent) return '';
  const rules = await prisma.agentMemoryRule.findMany({
    where: { userId: options.userId, agentId: options.agentId, status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
    take: 60,
  });
  return agentMemoryContext({ rules, query: options.query });
}
