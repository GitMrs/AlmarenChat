import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getBuiltInAgents } from '@/lib/agents-data';

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);

    const favorites = await prisma.favoriteAgent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const customAgentIds = favorites.filter((favorite) => favorite.source === 'custom').map((favorite) => favorite.agentId);
    const customAgents = customAgentIds.length
      ? await prisma.agent.findMany({ where: { id: { in: customAgentIds } } })
      : [];
    const customAgentMap = new Map(customAgents.map((agent) => [agent.id, agent]));

    const builtInAgents = await getBuiltInAgents();
    const builtInAgentMap = new Map(builtInAgents.map((agent) => [agent.id, agent]));

    return NextResponse.json({
      favorites: favorites
        .map((favorite) => ({
          ...favorite,
          agent:
            favorite.source === 'custom'
              ? customAgentMap.get(favorite.agentId)
              : builtInAgentMap.get(favorite.agentId),
        }))
        .filter((favorite) => favorite.agent),
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
    const { agentId, source = 'custom' } = await request.json();

    if (!agentId) {
      return NextResponse.json({ error: 'Missing agentId' }, { status: 400 });
    }

    if (!['builtin', 'custom'].includes(source)) {
      return NextResponse.json({ error: 'Invalid favorite source' }, { status: 400 });
    }

    const agent =
      source === 'custom'
        ? await prisma.agent.findUnique({ where: { id: agentId } })
        : (await getBuiltInAgents()).find((item) => item.id === agentId);

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const favorite = await prisma.favoriteAgent.upsert({
      where: { userId_source_agentId: { userId, source, agentId } },
      update: {},
      create: { userId, source, agentId },
    });

    return NextResponse.json({ favorite: { ...favorite, agent } });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
