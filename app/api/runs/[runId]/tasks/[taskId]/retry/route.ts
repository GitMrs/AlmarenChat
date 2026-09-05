import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { Prisma } from '@/src/generated/prisma/client';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ACTIVE_AGENT_RUN_STATUSES, agentRunInclude, getAgentRunForUser, isAgentRunActive } from '@/app/api/_lib/agent-runs';
import { appendAgentRunEvent } from '@/app/api/_lib/agent-run-events';
import { builtinSkill, skillSnapshot } from '@/lib/agent-runtime/skill-registry.mjs';
import { taskModelRequestLimit } from '@/lib/task-execution-plan.mjs';
import { cloneWorkspaceAttempt, discardWorkspaceAttempt, prepareWorkspaceAttempt } from '@/lib/workspace-staging.mjs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string; taskId: string }> }
) {
  let targetWorkspace: Parameters<typeof discardWorkspaceAttempt>[0] | null = null;
  try {
    const userId = requireAuth(request);
    const { runId, taskId } = await params;
    const existing = await getAgentRunForUser(runId, userId);
    if (!existing) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    if (isAgentRunActive(existing.status)) {
      return NextResponse.json({ error: '任务仍在运行，不能重试失败步骤' }, { status: 409 });
    }
    const task = existing.tasks.find((item) => item.id === taskId);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (task.status !== 'FAILED') {
      return NextResponse.json({ error: '只有失败步骤可以从此处重试' }, { status: 409 });
    }

    const continuationRunId = randomUUID();
    const continuationTaskId = randomUUID();
    const nextTaskAttempt = task.attempt + 1;
    const sourceWorkspace = {
      projectRoot: process.cwd(),
      userId,
      spaceId: existing.spaceId,
      taskId: task.id,
      attempt: task.attempt,
    };
    targetWorkspace = {
      projectRoot: process.cwd(),
      userId,
      spaceId: existing.spaceId,
      taskId: continuationTaskId,
      attempt: nextTaskAttempt,
    };
    let inheritedWorkspace = false;
    try {
      await cloneWorkspaceAttempt(sourceWorkspace, targetWorkspace);
      inheritedWorkspace = true;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      await prepareWorkspaceAttempt(targetWorkspace);
    }

    const timestamp = new Date();
    const currentBuiltinSkill = builtinSkill(task.skillId);
    const retrySkill = currentBuiltinSkill ? skillSnapshot(currentBuiltinSkill) : task.skillSnapshot;
    const retrySkillRecord = retrySkill && typeof retrySkill === 'object' && !Array.isArray(retrySkill)
      ? retrySkill as Record<string, Prisma.JsonValue>
      : null;
    const retrySkillId = typeof retrySkillRecord?.id === 'string' ? retrySkillRecord.id : task.skillId;
    const retrySkillVersion = typeof retrySkillRecord?.version === 'string'
      ? retrySkillRecord.version
      : task.skillVersion;
    const previousState = existing.coordinatorState && typeof existing.coordinatorState === 'object'
      ? existing.coordinatorState as Record<string, Prisma.JsonValue>
      : {};
    const run = await prisma.$transaction(async (transaction) => {
      const activeRun = await transaction.agentRun.findFirst({
        where: { spaceId: existing.spaceId, userId, status: { in: ACTIVE_AGENT_RUN_STATUSES } },
        select: { id: true },
      });
      if (activeRun) throw new Error('空间中已有任务正在运行');

      await transaction.agentRun.create({
        data: {
          id: continuationRunId,
          spaceId: existing.spaceId,
          userId,
          input: existing.input,
          status: 'QUEUED',
          retryOfId: existing.id,
          attempt: existing.attempt + 1,
          runtimeVersion: existing.runtimeVersion,
          modelRequestLimit: existing.modelRequestLimit,
          coordinatorState: {
            ...previousState,
            phase: 'executing',
            currentTaskId: continuationTaskId,
            currentTaskIds: [continuationTaskId],
            resumedFromTaskId: task.id,
            resumedAt: timestamp.toISOString(),
          } as Prisma.InputJsonValue,
          tasks: {
            create: {
              id: continuationTaskId,
              agentId: task.agentId,
              agentName: task.agentName,
              title: task.title,
              instruction: task.instruction,
              acceptanceCriteria: task.acceptanceCriteria,
              origin: 'failed_task_retry',
              parentTaskId: task.id,
              mode: task.mode,
              dependsOn: [],
              skillId: retrySkillId,
              skillVersion: retrySkillVersion,
              ...(retrySkill !== undefined ? {
                skillSnapshot: retrySkill === null
                  ? Prisma.JsonNull
                  : retrySkill as Prisma.InputJsonValue,
              } : {}),
              webResearchRequired: task.webResearchRequired,
              modelRequestLimit: taskModelRequestLimit(task.mode),
              status: 'PENDING',
              attempt: nextTaskAttempt,
              sortOrder: task.sortOrder,
              proposedAt: timestamp,
              approvedAt: timestamp,
              reviewFeedback: inheritedWorkspace
                ? `继承上一次失败步骤的暂存成果继续处理。上次失败原因：${task.error || '执行中断'}`
                : `上一次暂存成果已不可用，请基于正式工作区继续。上次失败原因：${task.error || '执行中断'}`,
            },
          },
        },
      });
      await appendAgentRunEvent(transaction, continuationRunId, {
        type: 'FAILED_TASK_RETRY_QUEUED',
        message: `从失败步骤“${task.title}”继续执行`,
        payload: {
          sourceRunId: existing.id,
          sourceTaskId: task.id,
          taskId: continuationTaskId,
          agentId: task.agentId,
          attempt: nextTaskAttempt,
          inheritedWorkspace,
        },
        taskId: continuationTaskId,
        agentId: task.agentId,
        attempt: nextTaskAttempt,
        actor: 'user',
      });
      await transaction.agentArtifactManifest.updateMany({
        where: { taskId: task.id, attempt: task.attempt, status: { not: 'APPLIED' } },
        data: { status: 'DISCARDED', updatedAt: timestamp },
      });
      return transaction.agentRun.findUniqueOrThrow({
        where: { id: continuationRunId },
        include: agentRunInclude,
      });
    });

    await discardWorkspaceAttempt(sourceWorkspace).catch(() => {});

    return NextResponse.json({ run, inheritedWorkspace }, { status: 201 });
  } catch (error: any) {
    if (targetWorkspace) await discardWorkspaceAttempt(targetWorkspace).catch(() => {});
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error.message === '空间中已有任务正在运行') {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
