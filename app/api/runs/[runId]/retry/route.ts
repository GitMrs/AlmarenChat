import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@/src/generated/prisma/client';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ACTIVE_AGENT_RUN_STATUSES, agentRunInclude, getAgentRunForUser, isAgentRunActive } from '@/app/api/_lib/agent-runs';
import { coordinatorAuthorization } from '@/lib/agent-runtime-v3-policy.mjs';
import { retryContextFromRuns } from '@/lib/run-retry-policy.mjs';
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

    const retryHistory = [existing];
    let ancestorId = existing.retryOfId;
    while (ancestorId && retryHistory.length < 20) {
      const ancestor = await prisma.agentRun.findFirst({
        where: { id: ancestorId, spaceId: existing.spaceId, userId },
        include: agentRunInclude,
      });
      if (!ancestor) break;
      retryHistory.push(ancestor);
      ancestorId = ancestor.retryOfId;
    }

    const historicalManifests = await prisma.agentArtifactManifest.findMany({
      where: { runId: { in: retryHistory.map((run) => run.id) } },
    });
    const manifestsByTaskId = new Map<string, typeof historicalManifests>();
    for (const manifest of historicalManifests) {
      const manifests = manifestsByTaskId.get(manifest.taskId) || [];
      manifests.push(manifest);
      manifestsByTaskId.set(manifest.taskId, manifests);
    }
    const retryHistoryWithManifests = retryHistory.map((run) => ({
      ...run,
      tasks: run.tasks.map((task) => ({
        ...task,
        artifactManifests: manifestsByTaskId.get(task.id) || [],
      })),
    }));
    const validationRetry = existing.status === 'FAILED_VALIDATION';
    const retryContext = retryContextFromRuns(retryHistoryWithManifests);
    const firstIncompleteTask = validationRetry
      ? existing.tasks[0]
      : existing.tasks.find((task) => task.status !== 'COMPLETED');
    const taskEntriesToCopy = existing.runtimeVersion >= 3
      ? retryContext.completedEntries
      : existing.runtimeVersion >= 2
        ? []
        : existing.tasks.map((task) => ({ task, manifest: null }));
    const copiedTasks = taskEntriesToCopy.map(({ task, manifest }) => {
      const completed = task.status === 'COMPLETED' && (existing.runtimeVersion >= 3 || !validationRetry);
      return {
        id: randomUUID(),
        agentId: task.agentId,
        agentName: task.agentName,
        title: task.title,
        instruction: task.instruction,
        acceptanceCriteria: task.acceptanceCriteria,
        origin: existing.runtimeVersion >= 3 ? 'retry_inherited' : task.origin,
        mode: task.mode,
        skillId: task.skillId,
        skillVersion: task.skillVersion,
        skillSnapshot: task.skillSnapshot ?? undefined,
        webResearchRequired: task.webResearchRequired,
        dependsOn: task.dependsOn ?? undefined,
        modelRequestLimit: task.modelRequestLimit,
        status: completed ? 'COMPLETED' : 'PENDING',
        result: completed ? task.result : null,
        error: null,
        reviewDecision: completed ? task.reviewDecision : null,
        reviewSummary: completed ? task.reviewSummary : null,
        reviewedAt: completed ? task.reviewedAt : null,
        submittedAt: completed ? task.submittedAt : null,
        approvedAt: completed ? task.approvedAt : null,
        attempt: task.attempt,
        sortOrder: task.sortOrder,
        startedAt: completed ? task.startedAt : null,
        completedAt: completed ? task.completedAt : null,
        inheritedManifest: completed ? manifest : null,
      };
    });
    const resumeMessage = existing.runtimeVersion >= 2
      ? copiedTasks.length > 0
        ? `第 ${existing.attempt + 1} 次尝试已进入队列，已继承 ${copiedTasks.length} 项验收成果，将只处理未完成内容`
        : `第 ${existing.attempt + 1} 次尝试已进入队列，协调者将重新派发工作`
      : firstIncompleteTask
      ? `第 ${existing.attempt + 1} 次尝试已进入队列，将从“${firstIncompleteTask.title}”继续`
      : `第 ${existing.attempt + 1} 次尝试已进入队列，将重新汇总已有结果`;
    const previousCoordinatorState = existing.coordinatorState && typeof existing.coordinatorState === 'object'
      ? existing.coordinatorState as Record<string, Prisma.JsonValue>
      : null;
    const inheritedAuthorization = retryContext.authorization && typeof retryContext.authorization === 'object'
      ? retryContext.authorization as Record<string, Prisma.JsonValue>
      : {};
    const refreshedAuthorization = existing.runtimeVersion >= 3
      ? coordinatorAuthorization(taskProposalWithServerCapabilities({
          goal: typeof inheritedAuthorization.objective === 'string' ? inheritedAuthorization.objective : existing.input,
          steps: inheritedAuthorization.steps,
          deliverables: inheritedAuthorization.deliverables,
          artifacts: inheritedAuthorization.artifacts,
          capabilities: inheritedAuthorization.capabilities,
          networkPolicy: inheritedAuthorization.networkPolicy,
        }, { networkPolicyAuthoritative: true }))
      : null;

    const automationExecution = retryContext.automated
      ? await prisma.spaceAutomationExecution.findFirst({
          where: { runId: { in: retryHistory.map((run) => run.id) } },
          select: { id: true, automationId: true },
        })
      : null;

    const run = await prisma.$transaction(async (transaction) => {
      const createdRun = await transaction.agentRun.create({
        data: {
        spaceId: existing.spaceId,
        workId: existing.workId,
        userId,
        input: existing.input,
        retryOfId: existing.id,
        attempt: existing.attempt + 1,
        executionEngine: existing.executionEngine,
        engineVersion: existing.engineVersion,
        runtimeVersion: existing.runtimeVersion,
        eventSequence: 1,
        coordinatorState: existing.runtimeVersion >= 2 && previousCoordinatorState
          ? existing.runtimeVersion >= 3
            ? {
                authorization: refreshedAuthorization as Prisma.InputJsonValue,
                phase: 'coordinating',
                authorizedAt: new Date().toISOString(),
                iteration: 0,
                taskCount: copiedTasks.length,
                currentTaskIds: [],
                ...(retryContext.automated ? { automated: true, automationId: retryContext.automationId } : {}),
              }
            : { ...previousCoordinatorState, phase: 'authorized', cursor: 0, currentTaskId: null }
          : undefined,
        modelRequestLimit: existing.modelRequestLimit,
        ...(copiedTasks.length > 0 ? { tasks: { create: copiedTasks.map(({ inheritedManifest, ...task }) => task) } } : {}),
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

      for (const task of copiedTasks) {
        if (!task.inheritedManifest) continue;
        await transaction.agentArtifactManifest.create({
          data: {
            runId: createdRun.id,
            taskId: task.id,
            attempt: task.attempt,
            status: task.inheritedManifest.status,
            baseline: task.inheritedManifest.baseline,
            entries: task.inheritedManifest.entries ?? undefined,
            validation: task.inheritedManifest.validation ?? undefined,
            completedAt: task.inheritedManifest.completedAt,
          },
        });
      }
      if (automationExecution) {
        await transaction.spaceAutomationExecution.update({
          where: { id: automationExecution.id },
          data: { runId: createdRun.id, status: 'TRIGGERED', error: null },
        });
        await transaction.spaceAutomation.update({
          where: { id: automationExecution.automationId },
          data: { lastRunId: createdRun.id },
        });
      }
      return createdRun;
    });
    return NextResponse.json({ run }, { status: 201 });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
