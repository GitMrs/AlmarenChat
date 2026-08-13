import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser } from '@/app/api/_lib/spaces';

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
