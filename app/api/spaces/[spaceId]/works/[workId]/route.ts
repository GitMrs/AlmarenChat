import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { templateLifecycleStage } from '@/lib/space-templates.mjs';

const WORK_STATUSES = new Set(['ACTIVE', 'COMPLETED', 'ARCHIVED']);

export async function PATCH(request: Request, { params }: { params: Promise<{ spaceId: string; workId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId, workId } = await params;
    const body = await request.json();
    const work = await prisma.spaceWork.findFirst({
      where: { id: workId, spaceId, space: { userId } },
      include: { space: { select: { templateSnapshot: true } } },
    });
    if (!work) return NextResponse.json({ error: '成果不存在' }, { status: 404 });
    const data: {
      title?: string;
      objective?: string | null;
      stage?: string | null;
      status?: string;
      completedAt?: Date | null;
    } = {};
    if (body?.title !== undefined) {
      const title = String(body.title || '').trim();
      if (!title) return NextResponse.json({ error: '成果名称不能为空' }, { status: 400 });
      if (title.length > 120) return NextResponse.json({ error: '成果名称不能超过 120 字' }, { status: 400 });
      data.title = title;
    }
    if (body?.objective !== undefined) {
      const objective = String(body.objective || '').trim();
      if (objective.length > 4000) return NextResponse.json({ error: '成果目标不能超过 4000 字' }, { status: 400 });
      data.objective = objective || null;
    }
    if (body?.stage !== undefined) {
      const stage = body.stage === null ? null : String(body.stage || '').trim();
      const snapshot = work.space.templateSnapshot && typeof work.space.templateSnapshot === 'object'
        ? work.space.templateSnapshot as Record<string, unknown>
        : null;
      if (stage && !templateLifecycleStage(snapshot, stage)) {
        return NextResponse.json({ error: '成果阶段无效' }, { status: 400 });
      }
      data.stage = stage || null;
    }
    if (body?.status !== undefined) {
      const status = String(body.status || '').trim().toUpperCase();
      if (!WORK_STATUSES.has(status)) return NextResponse.json({ error: '成果状态无效' }, { status: 400 });
      data.status = status;
      data.completedAt = status === 'COMPLETED' ? work.completedAt || new Date() : null;
      if (status === 'COMPLETED') {
        const snapshot = work.space.templateSnapshot && typeof work.space.templateSnapshot === 'object'
          ? work.space.templateSnapshot as Record<string, unknown>
          : null;
        if (templateLifecycleStage(snapshot, 'ready')) data.stage = 'ready';
      }
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ error: '没有可更新的成果字段' }, { status: 400 });
    const updated = await prisma.spaceWork.update({ where: { id: workId }, data });
    return NextResponse.json({ work: updated });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
