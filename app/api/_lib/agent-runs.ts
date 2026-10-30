import prisma from '@/app/api/_lib/db';

export const ACTIVE_AGENT_RUN_STATUSES = ['QUEUED', 'PLANNING', 'RUNNING', 'WAITING', 'WAITING_APPROVAL', 'SUMMARIZING', 'CANCEL_REQUESTED'];

export const agentRunInclude = {
  work: true,
  tasks: { orderBy: { sortOrder: 'asc' as const } },
  events: { orderBy: { sequence: 'asc' as const } },
};

export function getAgentRunForUser(runId: string, userId: string, afterSequence = 0) {
  return prisma.agentRun.findFirst({
    where: { id: runId, userId },
    include: {
      ...agentRunInclude,
      events: {
        ...agentRunInclude.events,
        ...(afterSequence > 0 ? { where: { sequence: { gt: afterSequence } } } : {}),
      },
    },
  });
}

export function isAgentRunActive(status: string) {
  return ACTIVE_AGENT_RUN_STATUSES.includes(status);
}
