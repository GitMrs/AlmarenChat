import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ensurePersonalAssistant } from '@/lib/personal-assistant/profile';

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const profile = await ensurePersonalAssistant(userId);

    const conversations = await prisma.conversation.findMany({
      where: { userId, kind: 'PERSONAL_ASSISTANT' },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true },
        },
        _count: {
          select: { messages: true },
        },
      },
    });

    const items = conversations.map((item) => ({
      id: item.id,
      title: item.title || '我的助理',
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      messageCount: item._count.messages,
      lastMessageSnippet: item.messages[0]?.content ? item.messages[0].content.slice(0, 80) : null,
      mode: item.id === profile.conversationId ? 'MAIN' : 'TEMPORARY',
    }));

    return NextResponse.json({
      conversations: items,
      currentConversationId: profile.conversationId,
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    await ensurePersonalAssistant(userId);

    const body = await request.json().catch(() => ({}));
    const rawTitle = typeof body.title === 'string' ? body.title.trim().slice(0, 40) : '';
    const title = rawTitle || '临时聊天';

    const result = await prisma.conversation.create({
      data: {
        userId,
        kind: 'PERSONAL_ASSISTANT',
        assistantMode: 'TEMPORARY',
        title,
      },
    });

    return NextResponse.json({
      conversationId: result.id,
      conversationMode: 'TEMPORARY',
      messages: [],
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
