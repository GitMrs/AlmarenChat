import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getAgentRunForUser } from '@/app/api/_lib/agent-runs';
import { canResumeWaiting, isExecutionBudgetWait, validateWaitAnswer } from '@/lib/agent-wait-policy.mjs';
import { appendAgentRunEvent } from '@/app/api/_lib/agent-run-events';
import { taskModelRequestLimit } from '@/lib/task-execution-plan.mjs';

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { runId } = await params;
    const body = await request.json();
    const existing = await getAgentRunForUser(runId, userId);
    if (!existing) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    const task = existing.tasks.find((item) => item.status === 'WAITING');
    if (!task || !canResumeWaiting(existing.status, task.status)) {
      return NextResponse.json({ error: '当前任务不在等待补充状态' }, { status: 409 });
    }
    const continuingExecution = isExecutionBudgetWait(task.waitReason);
    const answerValidation = continuingExecution
      ? { answer: '用户已确认继续执行', error: '' }
      : validateWaitAnswer(body.answer);
    if (answerValidation.error) return NextResponse.json({ error: answerValidation.error }, { status: 400 });
    const answer = answerValidation.answer;
    const addedModelRequests = taskModelRequestLimit(task.mode);

    const timestamp = new Date();
    await prisma.$transaction(async (transaction) => {
      const changed = await transaction.agentTask.updateMany({
        where: { id: task.id, runId, status: 'WAITING' },
        data: {
          status: 'PENDING',
          waitAnswer: answer,
          modelRequestLimit: { increment: addedModelRequests },
          startedAt: null,
          completedAt: null,
          error: null,
          updatedAt: timestamp,
        },
      });
      if (changed.count !== 1) throw new Error('当前等待请求已经处理');
      await transaction.agentRun.update({
        where: { id: runId },
        data: {
          status: 'QUEUED',
          workerId: null,
          heartbeatAt: null,
          error: null,
          completedAt: null,
          updatedAt: timestamp,
          modelRequestLimit: { increment: addedModelRequests },
        },
      });
      await appendAgentRunEvent(transaction, runId, {
          type: continuingExecution ? 'TASK_EXECUTION_CONTINUED' : 'TASK_INPUT_PROVIDED',
          message: continuingExecution ? `已确认${task.agentName}继续执行` : `已补充${task.agentName}继续执行所需的信息`,
          payload: { taskId: task.id, agentId: task.agentId, attempt: task.attempt, addedModelRequests },
          taskId: task.id,
          agentId: task.agentId,
          attempt: task.attempt,
          actor: 'user',
      });
    });

    const run = await getAgentRunForUser(runId, userId);
    return NextResponse.json({ run });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error.message === '当前等待请求已经处理') return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
