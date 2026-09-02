import prisma from '@/app/api/_lib/db';

type SharedPageContext = {
  type?: 'space' | 'run' | 'conversation' | 'agent';
  spaceId?: string;
  runId?: string;
  conversationId?: string;
  agentId?: string;
};

export async function buildAssistantPlatformContext(userId: string) {
  const [spaces, activeRuns, conversations] = await Promise.all([
    prisma.space.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, name: true, description: true, updatedAt: true },
    }),
    prisma.agentRun.findMany({
      where: {
        userId,
        status: { in: ['QUEUED', 'PLANNING', 'RUNNING', 'WAITING', 'WAITING_APPROVAL', 'SUMMARIZING', 'CANCEL_REQUESTED', 'FAILED'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 6,
      select: { id: true, spaceId: true, input: true, status: true, error: true, updatedAt: true },
    }),
    prisma.conversation.findMany({
      where: { userId, kind: 'AGENT' },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, title: true, agentName: true, updatedAt: true },
    }),
  ]);

  return JSON.stringify({ recentSpaces: spaces, activeOrFailedRuns: activeRuns, recentAgentChats: conversations });
}

export async function resolveSharedPageContext(userId: string, context?: SharedPageContext | null) {
  if (!context?.type) return null;
  if (context.type === 'space' && context.spaceId) {
    return prisma.space.findFirst({
      where: { id: context.spaceId, userId },
      select: { id: true, name: true, description: true, instructions: true, executionMode: true, updatedAt: true },
    });
  }
  if (context.type === 'run' && context.runId) {
    return prisma.agentRun.findFirst({
      where: { id: context.runId, userId },
      select: { id: true, spaceId: true, input: true, status: true, result: true, error: true, updatedAt: true },
    });
  }
  if (context.type === 'conversation' && context.conversationId) {
    return prisma.conversation.findFirst({
      where: { id: context.conversationId, userId, kind: 'AGENT' },
      select: { id: true, title: true, agentName: true, agentDescription: true, updatedAt: true },
    });
  }
  if (context.type === 'agent' && context.agentId) {
    return prisma.agent.findFirst({
      where: { id: context.agentId, OR: [{ isPublic: true }, { creatorId: userId }] },
      select: { id: true, name: true, description: true, category: true },
    });
  }
  return null;
}
