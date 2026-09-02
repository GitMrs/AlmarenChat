import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const searchParams = new URL(request.url).searchParams;
    const requestedLimit = Number(searchParams.get('limit'));
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(100, Math.round(requestedLimit))
      : undefined;
    const includeLastMessage = searchParams.get('includeLastMessage') !== 'false';

    const conversations = await prisma.conversation.findMany({
      where: { userId, kind: 'AGENT' },
      include: includeLastMessage ? {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, role: true, content: true, createdAt: true },
        },
      } : undefined,
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({
      conversations: includeLastMessage
        ? conversations.map((conversation: any) => ({
            ...conversation,
            messages: conversation.messages.map((message: any) => ({
              ...message,
              content: message.content.slice(0, 500),
            })),
          }))
        : conversations,
    });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const { agentId, title, agentSnapshot } = await request.json();

    if (!agentId) {
      return NextResponse.json({ error: 'Missing agentId' }, { status: 400 });
    }

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    const snapshot = agent || agentSnapshot || {};

    const conversation = await prisma.conversation.create({
      data: {
        userId,
        agentId,
        agentName: snapshot.name || null,
        agentAvatar: snapshot.avatar || null,
        agentCategory: snapshot.category || null,
        agentTone: snapshot.tone || null,
        agentDescription: snapshot.description || null,
        agentSystemPrompt: snapshot.systemPrompt || null,
        title,
      },
    });

    return NextResponse.json({ conversation });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
