import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ensurePersonalAssistant } from '@/lib/personal-assistant/profile';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const userId = requireAuth(request);
    await ensurePersonalAssistant(userId);
    const { conversationId } = await params;

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId, kind: 'PERSONAL_ASSISTANT' },
    });
    if (!conversation) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    }

    const [messages] = await prisma.$transaction([
      prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: 60,
      }),
      prisma.personalAssistantProfile.update({
        where: { userId },
        data: { conversationId },
      }),
    ]);

    return NextResponse.json({
      conversationId,
      messages: messages.reverse(),
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const profile = await ensurePersonalAssistant(userId);
    const { conversationId } = await params;

    const target = await prisma.conversation.findFirst({
      where: { id: conversationId, userId, kind: 'PERSONAL_ASSISTANT' },
    });
    if (!target) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    }

    let nextActiveId = profile.conversationId;
    let nextMessages: any[] | null = null;

    if (profile.conversationId === conversationId) {
      const fallback = await prisma.conversation.findFirst({
        where: {
          userId,
          kind: 'PERSONAL_ASSISTANT',
          id: { not: conversationId },
        },
        orderBy: { updatedAt: 'desc' },
      });

      if (fallback) {
        nextActiveId = fallback.id;
      } else {
        const fresh = await prisma.conversation.create({
          data: {
            userId,
            kind: 'PERSONAL_ASSISTANT',
            title: '我的助理',
          },
        });
        nextActiveId = fresh.id;
      }

      await prisma.personalAssistantProfile.update({
        where: { userId },
        data: { conversationId: nextActiveId },
      });

      const msgs = await prisma.message.findMany({
        where: { conversationId: nextActiveId },
        orderBy: { createdAt: 'desc' },
        take: 60,
      });
      nextMessages = msgs.reverse();
    }

    await prisma.$transaction([
      prisma.message.deleteMany({ where: { conversationId } }),
      prisma.conversation.delete({ where: { id: conversationId } }),
    ]);

    return NextResponse.json({
      success: true,
      currentConversationId: nextActiveId,
      ...(nextMessages !== null ? { messages: nextMessages } : {}),
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
