import prisma from '@/app/api/_lib/db';

export const ACTIVE_AGENT_RUN_STATUSES = ['QUEUED', 'PLANNING', 'RUNNING', 'WAITING', 'WAITING_APPROVAL', 'SUMMARIZING', 'CANCEL_REQUESTED'];

export const agentRunInclude = {
  tasks: { orderBy: { sortOrder: 'asc' as const } },
  events: { orderBy: { createdAt: 'asc' as const } },
};

export function getAgentRunForUser(runId: string, userId: string) {
  return prisma.agentRun.findFirst({
    where: { id: runId, userId },
    include: agentRunInclude,
  });
}

export function isAgentRunActive(status: string) {
  return ACTIVE_AGENT_RUN_STATUSES.includes(status);
}
