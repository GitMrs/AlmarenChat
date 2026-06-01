import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { createBlueprintRuntimeState, getAvailableBlueprintActions } from '@/lib/story-engine';
import type { MysteryBlueprint } from '@/types/blueprint';

function createEngineRuntimeState(builderConfig?: string | null) {
  if (!builderConfig) return null;

  try {
    const config = JSON.parse(builderConfig);
    const blueprint = config?.blueprint as MysteryBlueprint | undefined;
    if (!blueprint) return null;

    const state = createBlueprintRuntimeState(blueprint);
    return {
      engine: 'blueprint-v1',
      blueprint,
      state,
      nextActionIds: getAvailableBlueprintActions(blueprint, state).map((action) => action.id),
    };
  } catch {
    return null;
  }
}

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
    const { agentId, title } = await request.json();

    if (!agentId) {
      return NextResponse.json({ error: 'Missing agentId' }, { status: 400 });
    }

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    const engineRuntimeState = createEngineRuntimeState(agent?.builderConfig);

    const conversation = await prisma.conversation.create({
      data: {
        userId,
        agentId,
        agentName: agent?.name || null,
        agentAvatar: agent?.avatar || null,
        agentCategory: agent?.category || null,
        agentTone: agent?.tone || null,
        agentDescription: agent?.description || null,
        agentSystemPrompt: agent?.systemPrompt || null,
        runtimeState: engineRuntimeState ? JSON.stringify(engineRuntimeState) : null,
        currentScene: engineRuntimeState?.state.sceneId || null,
        currentObjective: engineRuntimeState?.state.objective || null,
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
