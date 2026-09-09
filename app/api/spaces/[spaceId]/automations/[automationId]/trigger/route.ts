import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string; automationId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId, automationId } = await params;
    const automation = await prisma.spaceAutomation.findFirst({
      where: { id: automationId, spaceId, deletedAt: null, space: { userId } },
    });
    if (!automation) return NextResponse.json({ error: '自动化不存在' }, { status: 404 });
    const updated = await prisma.spaceAutomation.update({
      where: { id: automationId },
      data: { enabled: true, nextRunAt: new Date(), lastError: null },
    });
    return NextResponse.json({ automation: updated });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
