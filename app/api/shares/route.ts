import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const files = await prisma.spaceFile.findMany({
      where: {
        shareEnabled: true,
        shareId: { not: null },
        space: { userId },
      },
      include: { space: { select: { name: true } } },
      orderBy: [{ sharedAt: 'desc' }, { updatedAt: 'desc' }],
    });
    return NextResponse.json({
      shares: files.map((file) => ({
        id: file.id,
        fileName: file.fileName,
        spaceId: file.spaceId,
        spaceName: file.space.name,
        url: `/share/${file.shareId}/`,
        sharedAt: file.sharedAt?.toISOString() || null,
        updatedAt: file.updatedAt?.toISOString() || null,
      })),
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: '加载网页共享失败' }, { status: 500 });
  }
}
