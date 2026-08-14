import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getAgentRunForUser, isAgentRunActive } from '@/app/api/_lib/agent-runs';

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { runId } = await params;
    const existing = await getAgentRunForUser(runId, userId);
    if (!existing) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    if (!isAgentRunActive(existing.status)) return NextResponse.json({ run: existing });

    const immediate = ['QUEUED', 'WAITING_APPROVAL'].includes(existing.status);
    const timestamp = new Date();
    await prisma.$transaction(async (transaction) => {
      if (immediate) {
        await transaction.agentTask.updateMany({
          where: { runId, status: { in: ['PENDING', 'RUNNING', 'WAITING_APPROVAL', 'CANCEL_REQUESTED'] } },
          data: { status: 'CANCELLED', completedAt: timestamp },
        });
        await transaction.spaceFile.updateMany({
          where: { runId, status: { in: ['GENERATING', 'WAITING_APPROVAL'] } },
          data: { status: 'INCOMPLETE', updatedAt: timestamp },
        });
      }
      await transaction.agentRun.update({
        where: { id: runId },
        data: { status: immediate ? 'CANCELLED' : 'CANCEL_REQUESTED', completedAt: immediate ? timestamp : undefined },
      });
      await transaction.agentRunEvent.create({
        data: {
          runId,
          type: immediate ? 'RUN_CANCELLED' : 'RUN_CANCEL_REQUESTED',
          message: immediate ? '任务已取消' : '已请求取消任务',
        },
      });
    });
    const run = await getAgentRunForUser(runId, userId);
    return NextResponse.json({ run });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
