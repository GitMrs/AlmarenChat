import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser } from '@/app/api/_lib/spaces';
import { initialWorkStage } from '@/lib/space-templates.mjs';

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    const works = await prisma.spaceWork.findMany({
      where: { spaceId },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        _count: { select: { files: true, runs: true } },
      },
    });
    return NextResponse.json({ works });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const body = await request.json();
    const title = String(body?.title || '').trim();
    const objective = typeof body?.objective === 'string' ? body.objective.trim() : '';
    if (!title) return NextResponse.json({ error: '成果名称不能为空' }, { status: 400 });
    if (title.length > 120) return NextResponse.json({ error: '成果名称不能超过 120 字' }, { status: 400 });
    if (objective.length > 4000) return NextResponse.json({ error: '成果目标不能超过 4000 字' }, { status: 400 });
    const templateSnapshot = space.templateSnapshot && typeof space.templateSnapshot === 'object'
      ? space.templateSnapshot as Record<string, unknown>
      : null;
    const kind = space.templateId || String(body?.kind || 'general').trim().slice(0, 80) || 'general';
    const work = await prisma.$transaction(async (tx) => {
      const created = await tx.spaceWork.create({
        data: {
          spaceId,
          title,
          kind,
          stage: initialWorkStage(templateSnapshot),
          objective: objective || null,
        },
      });
      await tx.space.update({ where: { id: spaceId }, data: { activeWorkId: created.id } });
      return created;
    });
    return NextResponse.json({ work }, { status: 201 });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
