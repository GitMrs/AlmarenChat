import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getAgentRunForUser, isAgentRunActive } from '@/app/api/_lib/agent-runs';
import { completionIdFor } from '@/lib/agent-completion-policy.mjs';
import { discardWorkspaceAttempt } from '@/lib/workspace-staging.mjs';
import { persistSpaceMemory } from '@/app/api/_lib/space-memory';
import { appendAgentRunEvent } from '@/app/api/_lib/agent-run-events';

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { runId } = await params;
    const existing = await getAgentRunForUser(runId, userId);
    if (!existing) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    if (!isAgentRunActive(existing.status)) return NextResponse.json({ run: existing });

    const immediate = ['QUEUED', 'WAITING', 'WAITING_APPROVAL'].includes(existing.status);
    const timestamp = new Date();
    const completionId = completionIdFor(runId);
    await prisma.$transaction(async (transaction) => {
      if (immediate) {
        await transaction.agentTask.updateMany({
          where: { runId, status: { in: ['PROPOSED', 'PENDING', 'QUEUED', 'RUNNING', 'WAITING', 'WAITING_USER', 'WAITING_APPROVAL', 'SUBMITTED', 'REVIEWING', 'REVISION_REQUIRED', 'CANCEL_REQUESTED'] } },
          data: { status: 'CANCELLED', completedAt: timestamp },
        });
        await transaction.spaceFile.deleteMany({
          where: { runId, status: { in: ['GENERATING', 'WAITING_APPROVAL'] } },
        });
      }
      await transaction.agentRun.update({
        where: { id: runId },
        data: {
          status: immediate ? 'CANCELLED' : 'CANCEL_REQUESTED',
          completionId: immediate ? completionId : undefined,
          completedAt: immediate ? timestamp : undefined,
        },
      });
      await appendAgentRunEvent(transaction, runId, {
          type: immediate ? 'RUN_CANCELLED' : 'RUN_CANCEL_REQUESTED',
          message: immediate ? '任务已取消' : '已请求取消任务',
          idempotencyKey: immediate ? completionId : undefined,
          actor: 'user',
      });
      if (immediate) {
        await transaction.agentRunOutbox.upsert({
          where: { runId },
          update: {},
          create: {
            runId,
            idempotencyKey: completionId,
            payload: {
              runId,
              spaceId: existing.spaceId,
              completionId,
              status: 'CANCELLED',
              result: null,
              error: null,
            },
          },
        });
      }
    });
    if (immediate) {
      const cleanup = await Promise.allSettled(existing.tasks.map((task) => discardWorkspaceAttempt({
        projectRoot: process.cwd(),
        userId,
        spaceId: existing.spaceId,
        taskId: task.id,
        attempt: task.attempt,
      })));
      const failures = cleanup.filter((result) => result.status === 'rejected');
      if (failures.length > 0) {
        await prisma.$transaction((transaction) => appendAgentRunEvent(transaction, runId, {
          type: 'WORKSPACE_STAGING_CLEANUP_FAILED',
          message: `${failures.length} 个任务暂存区清理失败`,
          actor: 'system',
        }));
      }
      await persistSpaceMemory(existing.spaceId, [{
        type: 'task_run',
        actor: '空间协调者',
        summary: `${existing.input}；状态：CANCELLED`,
        at: timestamp.toISOString(),
        refId: runId,
      }]);
    }
    const run = await getAgentRunForUser(runId, userId);
    return NextResponse.json({ run });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
