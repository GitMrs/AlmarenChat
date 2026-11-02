import prisma from '@/app/api/_lib/db';
import { extractRecentStates } from './conversation-continuity.mjs';

type HistoryItem = { id?: string; role?: string; content?: string; createdAt?: Date | string };

export async function syncRecentStates({ conversationId, history, now = new Date() }: { conversationId: string; history: HistoryItem[]; now?: Date }) {
  const states = extractRecentStates({ history, now });
  if (!conversationId) return [];

  await prisma.recentState.updateMany({
    where: { conversationId, status: 'UNCONFIRMED', expiresAt: { lt: now } },
    data: { status: 'EXPIRED' },
  });

  for (const state of states) {
    if (!state.sourceMessageId) continue;
    const existing = await prisma.recentState.findFirst({
      where: { conversationId, sourceMessageId: state.sourceMessageId },
      select: { id: true },
    });
    const data = {
      topic: state.topic,
      value: state.value,
      status: state.status,
      mentionedAt: new Date(state.mentionedAt),
      expiresAt: new Date(state.expiresAt),
      sourceMessageId: state.sourceMessageId,
    };
    if (existing) await prisma.recentState.update({ where: { id: existing.id }, data });
    else await prisma.recentState.create({ data: { conversationId, ...data } });
  }

  return prisma.recentState.findMany({
    where: { conversationId, status: { in: ['UNCONFIRMED', 'CLOSED'] } },
    orderBy: [{ mentionedAt: 'desc' }, { id: 'desc' }],
    take: 6,
  });
}

export async function loadRecentStates(conversationId: string, now = new Date()) {
  if (!conversationId) return [];
  await prisma.recentState.updateMany({
    where: { conversationId, status: 'UNCONFIRMED', expiresAt: { lt: now } },
    data: { status: 'EXPIRED' },
  });
  return prisma.recentState.findMany({
    where: { conversationId, status: { in: ['UNCONFIRMED', 'CLOSED'] } },
    orderBy: [{ mentionedAt: 'desc' }, { id: 'desc' }],
    take: 6,
  });
}
