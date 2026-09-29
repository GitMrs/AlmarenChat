import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { removeGeneratedChatImages } from '@/lib/generated-chat-images.mjs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { conversationId } = await params;

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId, kind: 'AGENT' },
    });

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    return NextResponse.json({ conversation });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { conversationId } = await params;

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId, kind: 'AGENT' },
    });

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    if (conversation.agentMode === 'MAIN') {
      return NextResponse.json({ error: 'Main conversation cannot be deleted' }, { status: 400 });
    }

    const messages = await prisma.message.findMany({ where: { conversationId }, select: { attachments: true } });
    await prisma.message.deleteMany({ where: { conversationId } });
    await prisma.conversation.delete({ where: { id: conversationId } });
    await Promise.all(messages.map((message) => removeGeneratedChatImages(message.attachments).catch(() => {})));

    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { conversationId } = await params;
    const { title, contextMessageLimit, archived } = await request.json();

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId, kind: 'AGENT' },
    });

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const data: { title?: string; contextMessageLimit?: number; archived?: boolean } = {};

    if (archived !== undefined) {
      if (conversation.agentMode === 'MAIN') {
        return NextResponse.json({ error: 'Main conversation cannot be archived' }, { status: 400 });
      }
      if (typeof archived !== 'boolean') {
        return NextResponse.json({ error: 'Archived value is invalid' }, { status: 400 });
      }
      data.archived = archived;
    }

    if (title !== undefined) {
      const nextTitle = typeof title === 'string' ? title.trim() : '';
      if (!nextTitle) {
        return NextResponse.json({ error: 'Title is required' }, { status: 400 });
      }
      data.title = nextTitle;
    }

    if (contextMessageLimit !== undefined) {
      const nextLimit = Number(contextMessageLimit);
      if (!Number.isFinite(nextLimit)) {
        return NextResponse.json({ error: 'Context message limit is invalid' }, { status: 400 });
      }
      data.contextMessageLimit = Math.max(1, Math.min(80, Math.round(nextLimit)));
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No changes provided' }, { status: 400 });
    }

    const updated = await prisma.conversation.update({
      where: { id: conversationId },
      data,
    });

    return NextResponse.json({ conversation: updated });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
