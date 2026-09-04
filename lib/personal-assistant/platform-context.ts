import prisma from '@/app/api/_lib/db';
import { classifyActivityTimestamps, resolveActivityRange } from '@/lib/personal-assistant/activity-query.mjs';

type SharedPageContext = {
  type?: 'space' | 'run' | 'conversation' | 'agent';
  spaceId?: string;
  runId?: string;
  conversationId?: string;
  agentId?: string;
};

export type AssistantContextSources = {
  spaces: boolean;
  tasks: boolean;
  chats: boolean;
};

export async function buildAssistantPlatformContext(userId: string, sources: AssistantContextSources) {
  const [spaces, activeRuns, conversations] = await Promise.all([
    sources.spaces ? prisma.space.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, name: true, description: true, updatedAt: true },
    }) : Promise.resolve([]),
    sources.tasks ? prisma.agentRun.findMany({
      where: {
        userId,
        status: { in: ['QUEUED', 'PLANNING', 'RUNNING', 'WAITING', 'WAITING_APPROVAL', 'SUMMARIZING', 'CANCEL_REQUESTED', 'FAILED'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 6,
      select: { id: true, spaceId: true, input: true, status: true, error: true, updatedAt: true },
    }) : Promise.resolve([]),
    sources.chats ? prisma.conversation.findMany({
      where: { userId, kind: 'AGENT' },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, title: true, agentName: true, updatedAt: true },
    }) : Promise.resolve([]),
  ]);

  return JSON.stringify({
    enabledSources: sources,
    ...(sources.spaces ? { recentSpaces: spaces } : {}),
    ...(sources.tasks ? { activeOrFailedRuns: activeRuns } : {}),
    ...(sources.chats ? { recentAgentChats: conversations } : {}),
  });
}

export async function buildAssistantActivityContext(userId: string, message: string, sources: AssistantContextSources) {
  const range = resolveActivityRange(message);
  if (!range) return null;

  const timeFilter = { gte: range.start, lt: range.end };
  const [runs, conversations, spaceMessages, files] = await Promise.all([
    sources.tasks ? prisma.agentRun.findMany({
      where: {
        userId,
        OR: [
          { createdAt: timeFilter },
          { updatedAt: timeFilter },
          { completedAt: timeFilter },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 16,
      select: {
        input: true,
        status: true,
        result: true,
        error: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
        space: { select: { name: true } },
      },
    }) : Promise.resolve([]),
    sources.chats ? prisma.message.findMany({
      where: { conversation: { userId, kind: 'AGENT' }, role: 'user', createdAt: timeFilter },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        content: true,
        createdAt: true,
        conversation: { select: { kind: true, title: true, agentName: true } },
      },
    }) : Promise.resolve([]),
    sources.spaces ? prisma.spaceMessage.findMany({
      where: { space: { userId }, role: 'user', createdAt: timeFilter },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { content: true, createdAt: true, space: { select: { name: true } } },
    }) : Promise.resolve([]),
    sources.spaces ? prisma.spaceFile.findMany({
      where: {
        space: { userId },
        OR: [{ createdAt: timeFilter }, { updatedAt: timeFilter }],
      },
      orderBy: { createdAt: 'desc' },
      take: 16,
      select: { fileName: true, status: true, createdAt: true, updatedAt: true, space: { select: { name: true } } },
    }) : Promise.resolve([]),
  ]);

  return JSON.stringify({
    label: range.label,
    range: { start: range.start.toISOString(), end: range.end.toISOString() },
    enabledSources: sources,
    runs: runs.map((item) => ({
      ...item,
      activities: classifyActivityTimestamps(item, range),
      input: item.input.slice(0, 300),
      result: item.result?.slice(0, 500) || null,
      error: item.error?.slice(0, 300) || null,
    })),
    conversationMessages: conversations.map((item) => ({ ...item, activity: '创建', content: item.content.slice(0, 300) })),
    spaceMessages: spaceMessages.map((item) => ({ ...item, activity: '创建', content: item.content.slice(0, 300) })),
    files: files.map((item) => ({ ...item, activities: classifyActivityTimestamps(item, range) })),
  });
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
