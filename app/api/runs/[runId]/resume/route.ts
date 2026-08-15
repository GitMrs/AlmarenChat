import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getAgentRunForUser } from '@/app/api/_lib/agent-runs';
import { canResumeWaiting, validateWaitAnswer } from '@/lib/agent-wait-policy.mjs';

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { runId } = await params;
    const body = await request.json();
    const answerValidation = validateWaitAnswer(body.answer);
    if (answerValidation.error) return NextResponse.json({ error: answerValidation.error }, { status: 400 });
    const answer = answerValidation.answer;

    const existing = await getAgentRunForUser(runId, userId);
    if (!existing) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    const task = existing.tasks.find((item) => item.status === 'WAITING');
    if (!task || !canResumeWaiting(existing.status, task.status)) {
      return NextResponse.json({ error: '当前任务不在等待补充状态' }, { status: 409 });
    }

    const timestamp = new Date();
    await prisma.$transaction(async (transaction) => {
      const changed = await transaction.agentTask.updateMany({
        where: { id: task.id, runId, status: 'WAITING' },
        data: {
          status: 'PENDING',
          waitAnswer: answer,
          attempt: { increment: 1 },
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
        },
      });
      await transaction.agentRunEvent.create({
        data: {
          runId,
          type: 'TASK_INPUT_PROVIDED',
          message: `已补充${task.agentName}继续执行所需的信息`,
          payload: { taskId: task.id, agentId: task.agentId, attempt: task.attempt + 1 },
        },
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
