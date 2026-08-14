import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getAgentRunForUser } from '@/app/api/_lib/agent-runs';

const REVIEW_ACTIONS = new Set(['approve', 'retry', 'skip']);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string; taskId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { runId, taskId } = await params;
    const body = await request.json();
    const action = typeof body.action === 'string' ? body.action : '';
    const feedback = typeof body.feedback === 'string' ? body.feedback.trim() : '';
    if (!REVIEW_ACTIONS.has(action)) return NextResponse.json({ error: 'Unsupported review action' }, { status: 400 });
    if (action === 'retry' && !feedback) return NextResponse.json({ error: '请填写需要修改的内容' }, { status: 400 });
    if (feedback.length > 4_000) return NextResponse.json({ error: '修正要求不能超过 4000 字' }, { status: 400 });

    const existing = await getAgentRunForUser(runId, userId);
    if (!existing) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    const task = existing.tasks.find((item) => item.id === taskId);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (existing.status !== 'WAITING_APPROVAL' || task.status !== 'WAITING_APPROVAL') {
      return NextResponse.json({ error: '当前步骤不在待审核状态' }, { status: 409 });
    }

    const timestamp = new Date();
    await prisma.$transaction(async (transaction) => {
      const taskData = action === 'approve'
        ? { status: 'COMPLETED', reviewedAt: timestamp, reviewFeedback: null }
        : action === 'retry'
          ? {
              status: 'PENDING',
              result: null,
              error: null,
              reviewFeedback: feedback,
              attempt: { increment: 1 },
              startedAt: null,
              completedAt: null,
              reviewedAt: null,
            }
          : { status: 'SKIPPED', reviewedAt: timestamp };
      const changed = await transaction.agentTask.updateMany({
        where: { id: taskId, runId, status: 'WAITING_APPROVAL' },
        data: taskData,
      });
      if (changed.count !== 1) throw new Error('当前步骤已经处理');

      await transaction.spaceFile.updateMany({
        where: { spaceId: existing.spaceId, runId, taskId },
        data: { status: action === 'approve' ? 'READY' : 'INCOMPLETE', updatedAt: timestamp },
      });
      await transaction.agentRun.update({
        where: { id: runId },
        data: { status: 'QUEUED', updatedAt: timestamp },
      });
      await transaction.agentRunEvent.create({
        data: {
          runId,
          type: action === 'approve' ? 'TASK_APPROVED' : action === 'retry' ? 'TASK_REVISION_REQUESTED' : 'TASK_SKIPPED',
          message: action === 'approve'
            ? `已确认${task.agentName}的阶段结果`
            : action === 'retry'
              ? `已要求${task.agentName}重做当前步骤`
              : `已跳过${task.agentName}的当前步骤`,
          payload: {
            taskId,
            agentId: task.agentId,
            attempt: action === 'retry' ? task.attempt + 1 : task.attempt,
            ...(action === 'retry' ? { feedback, previousResult: task.result } : {}),
          },
        },
      });
    });

    const run = await getAgentRunForUser(runId, userId);
    return NextResponse.json({ run });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error.message === '当前步骤已经处理') return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
