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
    const profile = await ensurePersonalAssistant(userId);
    const { conversationId } = await params;

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId, kind: 'PERSONAL_ASSISTANT' },
    });
    if (!conversation) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    }

    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });

    return NextResponse.json({
      conversationId,
      conversationMode: conversation.id === profile.conversationId ? 'MAIN' : 'TEMPORARY',
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
    if (target.id === profile.conversationId || target.assistantMode === 'MAIN') {
      return NextResponse.json({ error: '主聊天不能删除，可以清空其中的消息' }, { status: 409 });
    }

    const qqBinding = await prisma.assistantQQBinding.findUnique({ where: { userId } });
    if (qqBinding?.conversationId === conversationId) {
      await prisma.assistantQQBinding.update({
        where: { userId },
        data: { conversationId: profile.conversationId },
      });
    }

    await prisma.$transaction([
      prisma.message.deleteMany({ where: { conversationId } }),
      prisma.conversation.delete({ where: { id: conversationId } }),
    ]);

    const mainMessages = await prisma.message.findMany({
      where: { conversationId: profile.conversationId },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });

    return NextResponse.json({
      success: true,
      currentConversationId: profile.conversationId,
      messages: mainMessages.reverse(),
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
