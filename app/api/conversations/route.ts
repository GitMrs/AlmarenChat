import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);

    const conversations = await prisma.conversation.findMany({
      where: { userId },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({ conversations });
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
