import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser, resolveAgent } from '@/app/api/_lib/spaces';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; memberId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { spaceId, memberId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    const member = await prisma.spaceMember.findFirst({
      where: { id: memberId, spaceId },
    });
    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

    const body = await request.json();
    const updateData: Record<string, any> = {};

    if (body.roleName !== undefined) {
      updateData.roleName = typeof body.roleName === 'string' ? body.roleName.trim() || null : null;
    }
    if (body.modelName !== undefined) {
      updateData.modelName = typeof body.modelName === 'string' ? body.modelName.trim() || null : null;
    }
    if (body.apiBaseUrl !== undefined) {
      updateData.apiBaseUrl = typeof body.apiBaseUrl === 'string' ? body.apiBaseUrl.trim() || null : null;
    }
    if (body.apiKey !== undefined) {
      updateData.apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() || null : null;
    }

    const updated = await prisma.spaceMember.update({
      where: { id: memberId },
      data: updateData,
    });

    await prisma.space.update({
      where: { id: spaceId },
      data: {
        updatedAt: new Date(),
      },
    });

    const agent = await resolveAgent(updated.agentId, userId);
    return NextResponse.json({ member: { ...updated, agent } });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; memberId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { spaceId, memberId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    await prisma.spaceMember.deleteMany({ where: { id: memberId, spaceId } });
    await prisma.space.update({
      where: { id: spaceId },
      data: {
        updatedAt: new Date(),
      },
    });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
