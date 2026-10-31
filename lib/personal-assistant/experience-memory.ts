import { memoryCandidateWhere, recallExperiences, memoryArchiveDateFilter } from '@/lib/memory/memory-recall.mjs';
import { recallOriginalDetails } from '@/lib/memory/memory-store';
import { CHAT_ARCHIVE_TRIGGER, CHAT_ARCHIVE_BATCH, limitChatArchiveBatch, buildChatArchiveFallback, buildAssistantArchivePrompt, chatArchiveReferences, selectChatArchiveBatch, summarizeChatArchive } from '@/lib/memory/chat-archive.mjs';
import { randomUUID } from 'node:crypto';
import prisma from '@/app/api/_lib/db';
import { formatAssistantHistoryTimestamp } from '@/lib/personal-assistant/history-context.mjs';

export const EXPERIENCE_ARCHIVE_TRIGGER = CHAT_ARCHIVE_TRIGGER;
export const EXPERIENCE_ARCHIVE_BATCH = CHAT_ARCHIVE_BATCH;

type RawMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
};

type Summarizer = (prompt: string) => Promise<string | null>;

export function buildExperiencePrompt(messages: RawMessage[]) {
  return buildAssistantArchivePrompt(messages, formatAssistantHistoryTimestamp);
}

export function buildDeterministicExperienceSummary(messages: RawMessage[]) {
  return buildChatArchiveFallback(messages);
}

export async function archiveOldMainChatMessages(options: {
  userId: string;
  conversationId: string;
  summarize?: Summarizer;
}) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: options.conversationId,
      userId: options.userId,
      kind: 'PERSONAL_ASSISTANT',
      assistantMode: 'MAIN',
    },
    select: { id: true },
  });
  if (!conversation) return null;

  const unarchivedCount = await prisma.message.count({
    where: {
      conversationId: options.conversationId,
      assistantExperienceId: null,
      role: { in: ['user', 'assistant'] },
    },
  });
  if (unarchivedCount < EXPERIENCE_ARCHIVE_TRIGGER) return null;

  const pending = await prisma.message.findMany({
    where: {
      conversationId: options.conversationId,
      assistantExperienceId: null,
      role: { in: ['user', 'assistant'] },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: EXPERIENCE_ARCHIVE_BATCH,
    select: { id: true, role: true, content: true, createdAt: true },
  });
  if (pending.length < EXPERIENCE_ARCHIVE_BATCH) return null;
  const candidates = limitChatArchiveBatch(pending);

  const summary = await summarizeChatArchive(candidates, {
    summarize: options.summarize,
  });
  if (!summary) return null;

  const references = chatArchiveReferences(candidates);
  const experienceId = randomUUID();
  try {
    return await prisma.$transaction(async (tx) => {
      const experience = await tx.assistantExperience.create({
        data: {
          id: experienceId,
          userId: options.userId,
          conversationId: options.conversationId,
          summary,
          messageCount: references.messageCount,
          startAt: references.startAt,
          endAt: references.endAt,
        },
      });
      const claimed = await tx.message.updateMany({
        where: {
          id: { in: references.messageIds },
          conversationId: options.conversationId,
          assistantExperienceId: null,
        },
        data: { assistantExperienceId: experienceId },
      });
      if (claimed.count !== candidates.length) throw new Error('经历归档已被其他请求处理');
      return experience;
    });
  } catch (error: any) {
    if (error?.message === '经历归档已被其他请求处理') return null;
    throw error;
  }
}

export async function manualArchiveAssistantMessages(options: {
  userId: string;
  conversationId: string;
  preserveRecent?: number;
  summarize?: Summarizer;
}) {
  const preserveRecent = Math.max(0, options.preserveRecent ?? 4);
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: options.conversationId,
      userId: options.userId,
      kind: 'PERSONAL_ASSISTANT',
    },
    select: { id: true, assistantMode: true },
  });
  if (!conversation) {
    throw new Error('未找到对应的小伴对话');
  }

  const unarchivedMessages = await prisma.message.findMany({
    where: {
      conversationId: options.conversationId,
      assistantExperienceId: null,
      role: { in: ['user', 'assistant'] },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, role: true, content: true, createdAt: true },
  });

  if (unarchivedMessages.length <= preserveRecent) {
    throw new Error(`当前活跃对话仅有 ${unarchivedMessages.length} 条，无需归档（至少保留最近 ${preserveRecent} 条）`);
  }

  const candidates = selectChatArchiveBatch(unarchivedMessages, { preserveRecent });
  if (candidates.length === 0) {
    throw new Error('没有可归档的早期对话');
  }

  const summary = await summarizeChatArchive(candidates, {
    summarize: options.summarize,
  });
  if (!summary) {
    throw new Error('生成经历摘要失败');
  }

  const references = chatArchiveReferences(candidates);
  const experienceId = randomUUID();
  const experience = await prisma.$transaction(async (tx) => {
    const created = await tx.assistantExperience.create({
      data: {
        id: experienceId,
        userId: options.userId,
        conversationId: options.conversationId,
        summary,
        messageCount: references.messageCount,
        startAt: references.startAt,
        endAt: references.endAt,
      },
    });
    const claimed = await tx.message.updateMany({
      where: {
        id: { in: references.messageIds },
        conversationId: options.conversationId,
        assistantExperienceId: null,
      },
      data: { assistantExperienceId: experienceId },
    });
    if (claimed.count !== candidates.length) {
      throw new Error('经历归档已被其他请求并发处理，请重试');
    }
    return created;
  });

  return {
    experience: {
      id: experience.id,
      summary: experience.summary,
      messageCount: experience.messageCount,
      startAt: experience.startAt.toISOString(),
      endAt: experience.endAt.toISOString(),
      createdAt: experience.createdAt.toISOString(),
    },
    archivedCount: candidates.length,
    remainingCount: unarchivedMessages.length - candidates.length,
  };
}

export async function loadAssistantMemoryContext(options: {
  userId: string;
  conversationId: string;
  query: string;
  historyLimit: number;
  includeExperiences: boolean;
}) {
  const [history, experiencePool] = await Promise.all([
    prisma.message.findMany({
      where: {
        conversationId: options.conversationId,
        role: { in: ['user', 'assistant'] },
      },
      orderBy: { createdAt: 'desc' },
      take: options.historyLimit,
      select: { id: true, role: true, content: true, createdAt: true, attachments: true },
    }),
    options.includeExperiences
      ? prisma.assistantExperience.findMany({
          where: { userId: options.userId, conversationId: options.conversationId, AND: [memoryCandidateWhere(options.query), memoryArchiveDateFilter(options.query, 'assistant')] },
          orderBy: { endAt: 'desc' },
          take: 120,
          select: { id: true, summary: true, messageCount: true, startAt: true, endAt: true },
        })
      : Promise.resolve([]),
  ]);

  const recalled = recallExperiences(experiencePool, options.query);
  let originalContext = '';
  if (options.includeExperiences) {
    try { originalContext = await recallOriginalDetails({ userId: options.userId, kind: 'assistant', conversationId: options.conversationId }, options.query, recalled.items, history.map(message => message.id)); }
    catch { originalContext = '【历史原文查证】本轮未能读取原文；只可引用摘要，不得编造原话。'; }
  }
  return { history: history.reverse(), experienceContext: [recalled.context, originalContext].filter(Boolean).join('\n\n') };
}
