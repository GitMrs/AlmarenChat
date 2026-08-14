import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getAgentRunForUser, isAgentRunActive } from '@/app/api/_lib/agent-runs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string; taskId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { runId, taskId } = await params;
    const existing = await getAgentRunForUser(runId, userId);
    if (!existing) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

    const task = existing.tasks.find((item) => item.id === taskId);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (!isAgentRunActive(existing.status) || !['PENDING', 'RUNNING'].includes(task.status)) {
      return NextResponse.json({ run: existing });
    }

    const pending = task.status === 'PENDING';
    await prisma.$transaction(async (transaction) => {
      const changed = await transaction.agentTask.updateMany({
        where: { id: taskId, runId, status: task.status },
        data: {
          status: pending ? 'CANCELLED' : 'CANCEL_REQUESTED',
          completedAt: pending ? new Date() : undefined,
        },
      });
      if (changed.count === 0) return;
      await transaction.agentRunEvent.create({
        data: {
          runId,
          type: pending ? 'TASK_CANCELLED' : 'TASK_CANCEL_REQUESTED',
          message: pending ? `${task.agentName}的步骤已取消` : `已请求停止${task.agentName}的当前步骤`,
          payload: { taskId, agentId: task.agentId },
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
