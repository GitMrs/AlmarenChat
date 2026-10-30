import { ACTIVE_PLATFORM_RUN_STATUSES, compactPlatformText, platformContextRequest, serializePlatformContext } from './platform-context-policy.mjs';
import prisma from '@/app/api/_lib/db';
import { classifyActivityTimestamps, resolveActivityRange } from '@/lib/personal-assistant/activity-query.mjs';

export type AssistantContextSources = {
  spaces: boolean;
  tasks: boolean;
  chats: boolean;
};

export async function buildAssistantPlatformContext(userId: string, allowedSources: AssistantContextSources, message = '') {
  // Date-specific activity requests have a dedicated evidence query below.
  if (resolveActivityRange(message)) return null;
  const requested = platformContextRequest(message, allowedSources);
  const sources = requested.sources;
  if (!sources.spaces && !sources.tasks && !sources.chats) return null;
  const recentSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
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
        ...(requested.taskId ? { id: requested.taskId } : requested.taskSearch ? {
          OR: [{ input: { contains: requested.taskSearch } }, { work: { title: { contains: requested.taskSearch } } }],
        } : {
          OR: [{ status: { in: ACTIVE_PLATFORM_RUN_STATUSES } }, { updatedAt: { gte: recentSince } }],
        }),
      },
      orderBy: { updatedAt: 'desc' },
      take: 6,
      select: { id: true, spaceId: true, work: { select: { title: true } }, input: requested.details, status: true, error: requested.details, updatedAt: true },
    }) : Promise.resolve([]),
    sources.chats ? prisma.conversation.findMany({
      where: { userId, kind: 'AGENT' },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, title: true, agentName: true, updatedAt: true },
    }) : Promise.resolve([]),
  ]);

  return serializePlatformContext({
    enabledSources: allowedSources,
    includedSources: sources,
    scope: requested.taskId || requested.taskSearch ? '明确指定的任务' : '最近更新的空间/会话；任务限进行中或最近7天更新，非完整历史',
    ...(sources.spaces ? { recentSpaces: spaces.map((item) => ({
      id: item.id, name: compactPlatformText(item.name, 80), description: compactPlatformText(item.description, 120), updatedAt: item.updatedAt,
    })) } : {}),
    ...(sources.tasks ? { recentTasks: activeRuns.map((item) => ({
      id: item.id, spaceId: item.spaceId, title: compactPlatformText(item.work?.title || '未命名任务', 100), status: item.status, updatedAt: item.updatedAt,
      ...(requested.details ? { goalExcerpt: compactPlatformText(item.input, 240), errorExcerpt: compactPlatformText(item.error, 240) } : {}),
    })) } : {}),
    ...(sources.chats ? { recentAgentChats: conversations.map((item) => ({
      id: item.id, title: compactPlatformText(item.title, 80), agentName: compactPlatformText(item.agentName, 60), updatedAt: item.updatedAt,
    })) } : {}),
  });
}

export async function buildAssistantActivityContext(userId: string, message: string, allowedSources: AssistantContextSources) {
  const range = resolveActivityRange(message);
  if (!range) return null;
  const requested = platformContextRequest(message, allowedSources).sources;
  const hasSpecificSource = /任务|执行记录|运行记录|工作流|成果|空间|项目|agent|角色|智能体|会话/i.test(message);
  const sources = hasSpecificSource ? requested : allowedSources;

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

  return serializePlatformContext({
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
