import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const existing = await prisma.conversation.findFirst({
      where: { userId, agentId, kind: 'AGENT' },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return NextResponse.json({ conversation: existing, created: false });

    const conversation = await prisma.conversation.create({
      data: {
        userId,
        agentId,
        agentName: agent.name,
        agentAvatar: agent.avatar,
        agentCategory: agent.category,
        agentTone: agent.tone,
        agentDescription: agent.description,
        agentSystemPrompt: agent.systemPrompt,
        agentVoice: agent.voice,
        title: `${agent.name}的主聊天`,
      },
    });
    return NextResponse.json({ conversation, created: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message || 'Failed to load main conversation' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    const body = await request.json().catch(() => ({}));
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    const snapshot = agent || body.agentSnapshot || {};
    if (!snapshot.name) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const existing = await prisma.conversation.findFirst({
      where: { userId, agentId, kind: 'AGENT' },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return NextResponse.json({ conversation: existing, created: false });

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
        agentVoice: snapshot.voice || null,
        title: `${snapshot.name}的主聊天`,
      },
    });
    return NextResponse.json({ conversation, created: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message || 'Failed to create main conversation' }, { status: 500 });
  }
}
