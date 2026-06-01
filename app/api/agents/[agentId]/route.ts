import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

function normalizeJsonString(value: unknown) {
  if (value === undefined || value === null || typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
}

export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await params;

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    return NextResponse.json({ agent });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    const {
      name,
      avatar,
      description,
      category,
      tone,
      greeting,
      systemPrompt,
      model,
      isPublic,
      creationType,
      hook,
      worldSetting,
      playerRole,
      openingScene,
      rules,
      winConditions,
      estimatedDuration,
      difficulty,
      playerCount,
      tags,
      builderConfig,
    } = await request.json();

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    if (agent.creatorId !== userId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const updated = await prisma.agent.update({
      where: { id: agentId },
      data: {
        name,
        avatar,
        description,
        category,
        tone,
        greeting,
        systemPrompt,
        model,
        isPublic,
        creationType,
        hook,
        worldSetting,
        playerRole,
        openingScene,
        rules: normalizeJsonString(rules),
        winConditions,
        estimatedDuration,
        difficulty,
        playerCount,
        tags: normalizeJsonString(tags),
        builderConfig: normalizeJsonString(builderConfig),
      },
    });

    return NextResponse.json({ agent: updated });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    if (agent.creatorId !== userId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    await prisma.favoriteAgent.deleteMany({ where: { agentId, source: 'custom' } });
    await prisma.agent.delete({ where: { id: agentId } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
