import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser } from '@/app/api/_lib/spaces';
import { createWorkVersion } from '@/lib/work-versions.mjs';

export async function GET(_request: Request, { params }: { params: Promise<{ spaceId: string; workId: string }> }) {
  try {
    const userId = requireAuth(_request);
    const { spaceId, workId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const versions = await prisma.spaceWorkVersion.findMany({ where: { workId, work: { spaceId } }, orderBy: { version: 'desc' } });
    return NextResponse.json({ versions });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string; workId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId, workId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const work = await prisma.spaceWork.findFirst({ where: { id: workId, spaceId } });
    if (!work) return NextResponse.json({ error: '成果不存在' }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    const result = await createWorkVersion({
      prisma, userId, spaceId, work,
      summary: body?.summary,
      sourceRunId: typeof body?.runId === 'string' ? body.runId : null,
      sourceTaskId: typeof body?.taskId === 'string' ? body.taskId : null,
    });
    return NextResponse.json({ version: result.record, manifest: result.manifest }, { status: 201 });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error.code === 'ENOENT') return NextResponse.json({ error: '成果文件不存在，无法创建版本' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
