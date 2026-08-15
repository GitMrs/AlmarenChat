import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ACTIVE_AGENT_RUN_STATUSES, agentRunInclude, getAgentRunForUser, isAgentRunActive } from '@/app/api/_lib/agent-runs';

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { runId } = await params;
    const existing = await getAgentRunForUser(runId, userId);
    if (!existing) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    if (isAgentRunActive(existing.status)) {
      return NextResponse.json({ error: '任务仍在运行，不能重试' }, { status: 409 });
    }
    const activeRun = await prisma.agentRun.findFirst({
      where: { spaceId: existing.spaceId, userId, status: { in: ACTIVE_AGENT_RUN_STATUSES } },
      select: { id: true },
    });
    if (activeRun) {
      return NextResponse.json({ error: '空间中已有任务正在运行' }, { status: 409 });
    }

    const validationRetry = existing.status === 'FAILED_VALIDATION';
    const firstIncompleteTask = validationRetry
      ? existing.tasks[0]
      : existing.tasks.find((task) => task.status !== 'COMPLETED');
    const copiedTasks = existing.tasks.map((task) => {
      const completed = task.status === 'COMPLETED' && !validationRetry;
      return {
        agentId: task.agentId,
        agentName: task.agentName,
        title: task.title,
        instruction: task.instruction,
        mode: task.mode,
        dependsOn: task.dependsOn ?? undefined,
        modelRequestLimit: task.modelRequestLimit,
        status: completed ? 'COMPLETED' : 'PENDING',
        result: completed ? task.result : null,
        error: null,
        sortOrder: task.sortOrder,
        startedAt: completed ? task.startedAt : null,
        completedAt: completed ? task.completedAt : null,
      };
    });
    const resumeMessage = firstIncompleteTask
      ? `第 ${existing.attempt + 1} 次尝试已进入队列，将从“${firstIncompleteTask.title}”继续`
      : `第 ${existing.attempt + 1} 次尝试已进入队列，将重新汇总已有结果`;

    const run = await prisma.agentRun.create({
      data: {
        spaceId: existing.spaceId,
        userId,
        input: existing.input,
        retryOfId: existing.id,
        attempt: existing.attempt + 1,
        modelRequestLimit: existing.modelRequestLimit,
        ...(copiedTasks.length > 0 ? { tasks: { create: copiedTasks } } : {}),
        events: {
          create: {
            type: 'RUN_QUEUED',
            message: resumeMessage,
            payload: firstIncompleteTask ? { resumeFromSortOrder: firstIncompleteTask.sortOrder } : undefined,
          },
        },
      },
      include: agentRunInclude,
    });
    return NextResponse.json({ run }, { status: 201 });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
