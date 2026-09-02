import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { removeGeneratedChatImages } from '@/lib/generated-chat-images.mjs';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ conversationId: string; messageId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { conversationId, messageId } = await params;

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId, kind: 'AGENT' },
      select: { id: true },
    });

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const message = await prisma.message.findFirst({
      where: { id: messageId, conversationId },
      select: { attachments: true },
    });
    await prisma.message.deleteMany({
      where: { id: messageId, conversationId },
    });
    await removeGeneratedChatImages(message?.attachments).catch(() => {});

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
