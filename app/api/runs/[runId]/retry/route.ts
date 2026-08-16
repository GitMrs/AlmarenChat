import { NextResponse } from 'next/server';
import { Prisma } from '@/src/generated/prisma/client';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ACTIVE_AGENT_RUN_STATUSES, agentRunInclude, getAgentRunForUser, isAgentRunActive } from '@/app/api/_lib/agent-runs';
import { coordinatorAuthorization } from '@/lib/agent-runtime-v3-policy.mjs';
import { taskProposalWithServerCapabilities } from '@/lib/task-proposal-policy.mjs';

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
    const copiedTasks = existing.runtimeVersion >= 2 ? [] : existing.tasks.map((task) => {
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
    const resumeMessage = existing.runtimeVersion >= 2
      ? `第 ${existing.attempt + 1} 次尝试已进入队列，协调者将重新派发工作`
      : firstIncompleteTask
      ? `第 ${existing.attempt + 1} 次尝试已进入队列，将从“${firstIncompleteTask.title}”继续`
      : `第 ${existing.attempt + 1} 次尝试已进入队列，将重新汇总已有结果`;
    const previousCoordinatorState = existing.coordinatorState && typeof existing.coordinatorState === 'object'
      ? existing.coordinatorState as Record<string, Prisma.JsonValue>
      : null;
    const previousAuthorization = previousCoordinatorState?.authorization && typeof previousCoordinatorState.authorization === 'object'
      ? previousCoordinatorState.authorization as Record<string, Prisma.JsonValue>
      : {};
    const refreshedAuthorization = existing.runtimeVersion >= 3
      ? coordinatorAuthorization(taskProposalWithServerCapabilities({
          goal: typeof previousAuthorization.objective === 'string' ? previousAuthorization.objective : existing.input,
          steps: previousAuthorization.steps,
          deliverables: previousAuthorization.deliverables,
          artifacts: previousAuthorization.artifacts,
          capabilities: previousAuthorization.capabilities,
        }))
      : null;

    const run = await prisma.agentRun.create({
      data: {
        spaceId: existing.spaceId,
        userId,
        input: existing.input,
        retryOfId: existing.id,
        attempt: existing.attempt + 1,
        runtimeVersion: existing.runtimeVersion,
        eventSequence: 1,
        coordinatorState: existing.runtimeVersion >= 2 && previousCoordinatorState
          ? existing.runtimeVersion >= 3
            ? {
                authorization: refreshedAuthorization as Prisma.InputJsonValue,
                phase: 'coordinating',
                authorizedAt: new Date().toISOString(),
                iteration: 0,
                taskCount: 0,
                currentTaskIds: [],
              }
            : { ...previousCoordinatorState, phase: 'authorized', cursor: 0, currentTaskId: null }
          : undefined,
        modelRequestLimit: existing.modelRequestLimit,
        ...(copiedTasks.length > 0 ? { tasks: { create: copiedTasks } } : {}),
        events: {
          create: {
            type: 'RUN_QUEUED',
            message: resumeMessage,
            sequence: 1,
            actor: 'user',
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
