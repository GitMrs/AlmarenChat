import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { workspaceId } = await params;

    const workspace = await prisma.studioWorkspace.findFirst({
      where: { id: workspaceId, userId },
    });

    if (!workspace) {
      return NextResponse.json({ error: '工作区不存在或无权访问' }, { status: 404 });
    }

    const messages = await prisma.studioMessage.findMany({
      where: { workspaceId, userId },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({ messages });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const status = errMsg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: errMsg }, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { workspaceId } = await params;

    const workspace = await prisma.studioWorkspace.findFirst({
      where: { id: workspaceId, userId },
    });

    if (!workspace) {
      return NextResponse.json({ error: '工作区不存在或无权访问' }, { status: 404 });
    }

    await prisma.studioMessage.deleteMany({
      where: { workspaceId, userId },
    });

    return NextResponse.json({ success: true, workspaceId });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const status = errMsg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: errMsg }, { status });
  }
}
