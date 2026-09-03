import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ensurePersonalAssistant } from '@/lib/personal-assistant/profile';

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const profile = await ensurePersonalAssistant(userId);
    const [messages, memories, reminders] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: profile.conversationId },
        orderBy: { createdAt: 'desc' },
        take: 60,
      }),
      prisma.assistantMemoryItem.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.assistantReminder.findMany({
        where: {
          userId,
          status: { in: ['PENDING', 'COMPLETED'] },
        },
        orderBy: [
          { status: 'desc' },
          { dueTime: 'asc' },
          { createdAt: 'desc' },
        ],
        take: 30,
      }),
    ]);
    return NextResponse.json({
      profile: {
        name: profile.name,
        avatar: profile.avatar,
        identity: profile.identity,
        soul: profile.soul,
        greeting: profile.greeting,
        proactiveEnabled: profile.proactiveEnabled === null || profile.proactiveEnabled === undefined ? true : Boolean(profile.proactiveEnabled),
      },
      conversationId: profile.conversationId,
      messages: messages.reverse(),
      memories,
      reminders: reminders.map((r) => ({
        id: r.id,
        content: r.content,
        dueTime: r.dueTime ? r.dueTime.toISOString() : null,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
