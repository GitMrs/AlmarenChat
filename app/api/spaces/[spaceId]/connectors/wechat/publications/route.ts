import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await prisma.space.findFirst({ where: { id: spaceId, userId }, select: { id: true } });
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const actions = await prisma.spaceActionRequest.findMany({
      where: { spaceId, kind: { in: ['WECHAT_CREATE_DRAFT', 'WECHAT_PUBLISH'] } },
      select: {
        id: true,
        spaceId: true,
        workId: true,
        runId: true,
        automationExecutionId: true,
        kind: true,
        riskLevel: true,
        title: true,
        status: true,
        error: true,
        decidedBy: true,
        requestedAt: true,
        decidedAt: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
        work: { select: { id: true, title: true, kind: true, status: true, stage: true, objective: true, metadata: true, completedAt: true, createdAt: true, updatedAt: true } },
        connectorExecution: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return NextResponse.json({ actions });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
