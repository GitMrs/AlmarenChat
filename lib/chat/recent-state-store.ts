import prisma from '@/app/api/_lib/db';
import { extractRecentStates, parseRecentStateMessage, recentStateTransition } from './conversation-continuity.mjs';
import { logRecentStateLifecycle } from './recent-state-log.mjs';

type HistoryItem = { id?: string; role?: string; content?: string; createdAt?: Date | string };

export async function syncRecentStates({ conversationId, history, now = new Date() }: { conversationId: string; history: HistoryItem[]; now?: Date }) {
  const states = extractRecentStates({ history, now });
  if (!conversationId) return [];

  const expired = await prisma.recentState.updateMany({
    where: { conversationId, status: { in: ['UNCONFIRMED', 'PLANNED'] }, expiresAt: { lt: now } },
    data: { status: 'EXPIRED' },
  });
  if (expired.count) logRecentStateLifecycle({ action: 'expired', conversationId, status: 'EXPIRED', affected: expired.count });

  for (const state of states) {
    if (!state.sourceMessageId) continue;
    const existing = await prisma.recentState.findFirst({
      where: { conversationId, sourceMessageId: state.sourceMessageId },
      select: { id: true, status: true },
    });
    const data = {
      topic: state.topic,
      value: state.value,
      status: state.status,
      mentionedAt: new Date(state.mentionedAt),
      startsAt: state.startsAt ? new Date(state.startsAt) : null,
      expiresAt: new Date(state.expiresAt),
      sourceMessageId: state.sourceMessageId,
    };
    if (existing) {
      await prisma.recentState.update({ where: { id: existing.id }, data });
      if (existing.status !== state.status) logRecentStateLifecycle({
        action: state.status === 'CLOSED' ? 'closed' : state.status === 'CANCELLED' ? 'cancelled' : state.status === 'EXPIRED' ? 'expired' : 'status_changed',
        conversationId, sourceMessageId: state.sourceMessageId,
        topics: [state.topic], status: state.status, affected: 1,
      });
    } else {
      await prisma.recentState.create({ data: { conversationId, ...data } });
      logRecentStateLifecycle({
        action: 'created', conversationId, sourceMessageId: state.sourceMessageId,
        topics: [state.topic], status: state.status, affected: 1,
      });
    }
  }

  return prisma.recentState.findMany({
    where: { conversationId, status: { in: ['UNCONFIRMED', 'PLANNED'] } },
    orderBy: [{ mentionedAt: 'desc' }, { id: 'desc' }],
    take: 6,
  });
}

export async function loadRecentStates(conversationId: string, now = new Date()) {
  if (!conversationId) return [];
  const expired = await prisma.recentState.updateMany({
    where: { conversationId, status: { in: ['UNCONFIRMED', 'PLANNED'] }, expiresAt: { lt: now } },
    data: { status: 'EXPIRED' },
  });
  if (expired.count) logRecentStateLifecycle({ action: 'expired', conversationId, status: 'EXPIRED', affected: expired.count });
  return prisma.recentState.findMany({
    where: { conversationId, status: { in: ['UNCONFIRMED', 'PLANNED'] } },
    orderBy: [{ mentionedAt: 'desc' }, { id: 'desc' }],
    take: 6,
  });
}

export async function applyRecentStateMessage({ conversationId, message, now = new Date() }: { conversationId: string; message: HistoryItem; now?: Date }) {
  if (!conversationId || message.role !== 'user' || !message.content || !message.createdAt) return;
  const expired = await prisma.recentState.updateMany({
    where: { conversationId, status: { in: ['UNCONFIRMED', 'PLANNED'] }, expiresAt: { lt: now } },
    data: { status: 'EXPIRED' },
  });
  if (expired.count) logRecentStateLifecycle({ action: 'expired', conversationId, status: 'EXPIRED', affected: expired.count });
  const transition = recentStateTransition(message.content);
  if (transition.closedTopics.length) {
    const closed = await prisma.recentState.updateMany({
      where: { conversationId, topic: { in: transition.closedTopics }, status: { in: ['UNCONFIRMED', 'PLANNED'] } },
      data: { status: 'CLOSED' },
    });
    if (closed.count) logRecentStateLifecycle({
      action: 'closed', conversationId, sourceMessageId: message.id,
      topics: transition.closedTopics, status: 'CLOSED', affected: closed.count,
    });
  }
  if (transition.cancelledTopics.length) {
    const cancelled = await prisma.recentState.updateMany({
      where: { conversationId, topic: { in: transition.cancelledTopics }, status: { in: ['UNCONFIRMED', 'PLANNED'] } },
      data: { status: 'CANCELLED' },
    });
    if (cancelled.count) logRecentStateLifecycle({
      action: 'cancelled', conversationId, sourceMessageId: message.id,
      topics: transition.cancelledTopics, status: 'CANCELLED', affected: cancelled.count,
    });
  }
  if (transition.cancelLatest) {
    const latest = await prisma.recentState.findFirst({
      where: { conversationId, status: { in: ['UNCONFIRMED', 'PLANNED'] } }, orderBy: [{ mentionedAt: 'desc' }, { id: 'desc' }], select: { id: true, topic: true },
    });
    if (latest) {
      await prisma.recentState.update({ where: { id: latest.id }, data: { status: 'CANCELLED' } });
      logRecentStateLifecycle({
        action: 'cancelled', conversationId, sourceMessageId: message.id,
        topics: [latest.topic], status: 'CANCELLED', affected: 1,
      });
    }
  }
  const state = parseRecentStateMessage({ id: message.id, content: message.content, createdAt: new Date(message.createdAt) });
  if (!state || !state.sourceMessageId) return;
  await prisma.recentState.updateMany({
    where: { conversationId, topic: state.topic, status: { in: ['UNCONFIRMED', 'PLANNED'] } }, data: { status: 'CLOSED' },
  });
  const existing = await prisma.recentState.findFirst({ where: { conversationId, sourceMessageId: state.sourceMessageId }, select: { id: true } });
  const data = {
    topic: state.topic, value: state.value, status: state.status, mentionedAt: new Date(state.mentionedAt),
    startsAt: state.startsAt ? new Date(state.startsAt) : null, expiresAt: new Date(state.expiresAt), sourceMessageId: state.sourceMessageId,
  };
  if (existing) await prisma.recentState.update({ where: { id: existing.id }, data });
  else {
    await prisma.recentState.create({ data: { conversationId, ...data } });
    logRecentStateLifecycle({
      action: 'created', conversationId, sourceMessageId: state.sourceMessageId,
      topics: [state.topic], status: state.status, affected: 1,
    });
  }
}
