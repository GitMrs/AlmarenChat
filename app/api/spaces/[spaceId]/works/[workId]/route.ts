import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

export async function PATCH(request: Request, { params }: { params: Promise<{ spaceId: string; workId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId, workId } = await params;
    const title = String((await request.json())?.title || '').trim();
    if (!title) return NextResponse.json({ error: '成果名称不能为空' }, { status: 400 });
    if (title.length > 120) return NextResponse.json({ error: '成果名称不能超过 120 字' }, { status: 400 });
    const work = await prisma.spaceWork.findFirst({ where: { id: workId, spaceId, space: { userId } } });
    if (!work) return NextResponse.json({ error: '成果不存在' }, { status: 404 });
    const updated = await prisma.spaceWork.update({ where: { id: workId }, data: { title } });
    return NextResponse.json({ work: updated });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
