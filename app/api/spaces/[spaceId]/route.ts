import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { SPACE_COORDINATOR_ID, getSpaceForUser } from '@/app/api/_lib/spaces';

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    return NextResponse.json({ space });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const { name, description, instructions, hostAgentId } = await request.json();

    const space = await prisma.space.findFirst({ where: { id: spaceId, userId } });
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    const data: { name?: string; description?: string | null; instructions?: string | null; hostAgentId?: string | null } = {};
    if (name !== undefined) {
      const title = typeof name === 'string' ? name.trim() : '';
      if (!title) return NextResponse.json({ error: '空间名称不能为空' }, { status: 400 });
      data.name = title;
    }
    if (description !== undefined) {
      data.description = typeof description === 'string' ? description.trim() || null : null;
    }
    if (instructions !== undefined) {
      const value = typeof instructions === 'string' ? instructions.trim() : '';
      if (value.length > 12_000) {
        return NextResponse.json({ error: '空间规则不能超过 12000 字' }, { status: 400 });
      }
      data.instructions = value || null;
    }
    if (hostAgentId !== undefined) {
      if (hostAgentId === null || hostAgentId === '' || hostAgentId === SPACE_COORDINATOR_ID) {
        data.hostAgentId = SPACE_COORDINATOR_ID;
      } else {
        return NextResponse.json({ error: '空间默认协调者不可替换；请用 @ 指定普通成员。' }, { status: 400 });
      }
    }

    const updated = await prisma.space.update({ where: { id: spaceId }, data });
    return NextResponse.json({ space: updated });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await prisma.space.findFirst({ where: { id: spaceId, userId } });
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    await prisma.space.delete({ where: { id: spaceId } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
