import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser } from '@/app/api/_lib/spaces';

function shareUrl(shareId: string | null) {
  return shareId ? `/share/${shareId}/` : null;
}

async function ownedHtmlFile(request: Request, spaceId: string, fileId: string) {
  const userId = requireAuth(request);
  const space = await getSpaceForUser(spaceId, userId);
  if (!space) return null;
  const file = await prisma.spaceFile.findFirst({ where: { id: fileId, spaceId } });
  if (!file || !/\.html?$/i.test(file.fileName)) return null;
  return file;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; fileId: string }> }
) {
  try {
    const { spaceId, fileId } = await params;
    const file = await ownedHtmlFile(request, spaceId, fileId);
    if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    return NextResponse.json({
      enabled: file.shareEnabled,
      url: file.shareEnabled ? shareUrl(file.shareId) : null,
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: '读取共享状态失败' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; fileId: string }> }
) {
  try {
    const { spaceId, fileId } = await params;
    const file = await ownedHtmlFile(request, spaceId, fileId);
    if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (file.status !== 'READY') {
      return NextResponse.json({ error: '当前文件状态不允许公开共享' }, { status: 409 });
    }
    const shareId = file.shareEnabled && file.shareId
      ? file.shareId
      : randomUUID().replaceAll('-', '');
    await prisma.spaceFile.update({
      where: { id: file.id },
      data: { shareId, shareEnabled: true, sharedAt: new Date() },
    });
    return NextResponse.json({ enabled: true, url: shareUrl(shareId) });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: '开启共享失败' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; fileId: string }> }
) {
  try {
    const { spaceId, fileId } = await params;
    const file = await ownedHtmlFile(request, spaceId, fileId);
    if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    await prisma.spaceFile.update({
      where: { id: file.id },
      data: { shareId: null, shareEnabled: false, sharedAt: null },
    });
    return NextResponse.json({ enabled: false, url: null });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: '关闭共享失败' }, { status: 500 });
  }
}
