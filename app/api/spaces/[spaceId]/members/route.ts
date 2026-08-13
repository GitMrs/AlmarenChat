import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser, resolveAgent } from '@/app/api/_lib/spaces';

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    const agents = await Promise.all(space.members.map((member) => resolveAgent(member.agentId, userId)));
    return NextResponse.json({
      members: space.members.map((member, index) => ({ ...member, agent: agents[index] })),
    });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const { agentId, roleName } = await request.json();

    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    const agent = await resolveAgent(String(agentId || ''), userId);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const member = await prisma.spaceMember.upsert({
      where: { spaceId_agentId: { spaceId, agentId: agent.id } },
      update: {
        roleName: typeof roleName === 'string' ? roleName.trim() || agent.category || null : agent.category || null,
      },
      create: {
        spaceId,
        agentId: agent.id,
        roleName: typeof roleName === 'string' ? roleName.trim() || agent.category || null : agent.category || null,
        sortOrder: space.members.length,
      },
    });

    await prisma.space.update({
      where: { id: spaceId },
      data: {
        updatedAt: new Date(),
      },
    });
    return NextResponse.json({ member: { ...member, agent } });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
