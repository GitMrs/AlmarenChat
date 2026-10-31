import { NextResponse } from 'next/server';
import { Prisma } from '@/src/generated/prisma/client';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getAgentRunForUser, isAgentRunActive } from '@/app/api/_lib/agent-runs';
import { appendAgentRunEvent } from '@/app/api/_lib/agent-run-events';
import { persistSpaceMemory } from '@/app/api/_lib/space-memory';
import { completionIdFor } from '@/lib/agents/runtime/agent-completion-policy.mjs';

const COVERAGE_MISMATCH_MARKER = '完成清单未对齐';

function manualCompletionResult(tasks: Array<{ title: string; result: string | null }>) {
  const results = tasks
    .map((task) => ({ title: task.title, result: String(task.result || '').trim() }))
    .filter((task) => task.result);
  if (results.length === 0) return null;
  const body = results.length === 1
    ? results[0].result
    : results.map((task) => `【${task.title}】\n${task.result}`).join('\n\n');
  return `${body}\n\n用户已确认现有验收成果完成。`;
}

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { runId } = await params;
    const existing = await getAgentRunForUser(runId, userId);
    if (!existing) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    if (isAgentRunActive(existing.status)) {
      return NextResponse.json({ error: '任务仍在运行，不能手动完成' }, { status: 409 });
    }
    if (existing.status !== 'BLOCKED' || !String(existing.error || '').includes(COVERAGE_MISMATCH_MARKER)) {
      return NextResponse.json({ error: '只有完成清单未对齐的任务可以由用户确认完成' }, { status: 409 });
    }

    const completedTasks = existing.tasks.filter((task) => (
      task.status === 'COMPLETED' && String(task.result || '').trim()
    ));
    const result = manualCompletionResult(completedTasks);
    if (!result) {
      return NextResponse.json({ error: '没有可确认的已验收成果' }, { status: 409 });
    }

    const timestamp = new Date();
    const completionId = completionIdFor(runId);
    let coordinatorState: Record<string, unknown> = {};
    if (existing.coordinatorState && typeof existing.coordinatorState === 'object' && !Array.isArray(existing.coordinatorState)) {
      coordinatorState = existing.coordinatorState as Record<string, unknown>;
    }
    const finalCoordinatorState = {
      ...coordinatorState,
      phase: 'completed',
      currentTaskIds: [],
      completedAt: timestamp.toISOString(),
      manualCompletion: true,
      manualCompletionReason: '用户确认现有验收成果完成',
    };

    await prisma.$transaction(async (transaction) => {
      await transaction.agentRun.update({
        where: { id: runId },
        data: {
          status: 'COMPLETED',
          completionId,
          result,
          error: null,
          workerId: null,
          heartbeatAt: null,
          completedAt: timestamp,
          coordinatorState: finalCoordinatorState as Prisma.InputJsonValue,
        },
      });
      if (existing.workId) {
        await transaction.spaceWork.updateMany({
          where: { id: existing.workId },
          data: {
            status: 'ACTIVE',
            stage: 'review',
            completedAt: null,
            updatedAt: timestamp,
          },
        });
      }
      await appendAgentRunEvent(transaction, runId, {
        type: 'RUN_COMPLETED',
        message: '用户确认现有验收成果完成',
        idempotencyKey: completionId,
        actor: 'user',
        payload: {
          manual: true,
          coverageMismatch: true,
          taskIds: completedTasks.map((task) => task.id),
        },
      });
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
            status: 'COMPLETED',
            result,
            error: null,
          },
        },
      });
    });

    try {
      await persistSpaceMemory(existing.spaceId, [{
        type: 'task_run',
        actor: '用户',
        summary: `${existing.input}；状态：COMPLETED；用户确认现有成果完成`,
        at: timestamp.toISOString(),
        refId: runId,
      }]);
    } catch (memoryError) {
      console.warn('[agent-run] failed to persist manual completion memory', {
        runId,
        error: memoryError instanceof Error ? memoryError.message : String(memoryError),
      });
    }

    const run = await getAgentRunForUser(runId, userId);
    return NextResponse.json({ run });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
