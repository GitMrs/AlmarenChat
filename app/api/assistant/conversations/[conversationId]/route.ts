import { ASSISTANT_RECENT_MESSAGE_LIMIT } from '@/lib/memory/conversation-context-policy.mjs';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ensurePersonalAssistant } from '@/lib/personal-assistant/profile';

export async function GET(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { conversationId } = await params;
    const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, userId, kind: 'PERSONAL_ASSISTANT' } });
    if (!conversation) return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    const query = new URL(request.url).searchParams;
    const before = query.get('before');
    const beforeId = query.get('beforeId');
    const requestedLimit = Number(query.get('limit') || 60);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || (before && !Number.isFinite(Date.parse(before))) || (beforeId && !before)) {
      return NextResponse.json({ error: 'Invalid message pagination' }, { status: 400 });
    }
    const limit = Math.min(requestedLimit, 100);
    const rows = await prisma.message.findMany({
      where: { conversationId, ...(before ? { OR: [
        { createdAt: { lt: new Date(before) } },
        ...(beforeId ? [{ createdAt: new Date(before), id: { lt: beforeId } }] : []),
      ] } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1,
    });
    return NextResponse.json({ messages: rows.slice(0, limit).reverse(), hasMore: rows.length > limit });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { conversationId } = await params;
    const body = await request.json().catch(() => null);
    const limit = body?.contextMessageLimit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 80) {
      return NextResponse.json({ error: '请输入 1～80 的整数' }, { status: 400 });
    }
    const result = await prisma.conversation.updateMany({
      where: { id: conversationId, userId, kind: 'PERSONAL_ASSISTANT' },
      data: { contextMessageLimit: limit },
    });
    if (!result.count) return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    return NextResponse.json({ contextMessageLimit: limit });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

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
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 61,
    });

    return NextResponse.json({
      conversationId,
      contextMessageLimit: conversation.contextMessageLimit ?? ASSISTANT_RECENT_MESSAGE_LIMIT,
      conversationMode: conversation.id === profile.conversationId ? 'MAIN' : 'TEMPORARY',
      messages: messages.slice(0, 60).reverse(),
      hasMore: messages.length > 60,
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
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 61,
    });

    return NextResponse.json({
      success: true,
      currentConversationId: profile.conversationId,
      contextMessageLimit: profile.conversation.contextMessageLimit ?? ASSISTANT_RECENT_MESSAGE_LIMIT,
      messages: mainMessages.slice(0, 60).reverse(),
      hasMore: mainMessages.length > 60,
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
