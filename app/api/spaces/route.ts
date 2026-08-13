import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { SPACE_COORDINATOR_ID, ensureSpaceRoot, resolveManyAgents } from '@/app/api/_lib/spaces';

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const spaces = await prisma.space.findMany({
      where: { userId },
      include: {
        members: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: {
          select: { members: true, messages: true, files: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({ spaces });
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
    const { name, description, agentIds } = await request.json();
    const title = typeof name === 'string' ? name.trim() : '';
    if (!title) {
      return NextResponse.json({ error: '空间名称不能为空' }, { status: 400 });
    }

    const resolvedAgents = await resolveManyAgents(Array.isArray(agentIds) ? agentIds : [], userId);
    const space = await prisma.space.create({
      data: {
        userId,
        name: title,
        description: typeof description === 'string' ? description.trim() || null : null,
        hostAgentId: SPACE_COORDINATOR_ID,
        members: {
          create: resolvedAgents
            .map((agent, index) => ({
              agentId: agent.id,
              roleName: agent.category || null,
              sortOrder: index,
            })),
        },
      },
      include: {
        members: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    await ensureSpaceRoot(userId, space.id);
    return NextResponse.json({ space });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
