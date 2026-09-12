import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser } from '@/app/api/_lib/spaces';
import { restoreWorkVersion } from '@/lib/work-versions.mjs';

export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string; workId: string; versionId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId, workId, versionId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const work = await prisma.spaceWork.findFirst({ where: { id: workId, spaceId } });
    const version = await prisma.spaceWorkVersion.findFirst({ where: { id: versionId, workId } });
    if (!work || !version) return NextResponse.json({ error: '成果或版本不存在' }, { status: 404 });
    await restoreWorkVersion({ prisma, userId, spaceId, work, version });
    return NextResponse.json({ restored: true, version });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error.code === 'ENOENT') return NextResponse.json({ error: '版本文件不存在，无法恢复' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
