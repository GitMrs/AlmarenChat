import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { summarizeSpaceOperations } from '@/lib/space-operations.mjs';

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await prisma.space.findFirst({ where: { id: spaceId, userId }, select: { id: true } });
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const periodDays = 30;
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
    const [works, runs, automationExecutions, actions] = await Promise.all([
      prisma.spaceWork.findMany({ where: { spaceId }, select: { status: true, stage: true } }),
      prisma.agentRun.findMany({ where: { spaceId, createdAt: { gte: since } }, select: { status: true } }),
      prisma.spaceAutomationExecution.findMany({
        where: { automation: { spaceId }, createdAt: { gte: since } },
        select: { status: true },
      }),
      prisma.spaceActionRequest.findMany({
        where: { spaceId, createdAt: { gte: since } },
        select: { id: true, kind: true, title: true, status: true, error: true, createdAt: true, completedAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return NextResponse.json({
      summary: summarizeSpaceOperations({ works, runs, automationExecutions, actions }, periodDays),
      recentOutcomes: actions
        .filter((action) => ['WECHAT_CREATE_DRAFT', 'WECHAT_PUBLISH'].includes(action.kind))
        .slice(0, 10),
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
