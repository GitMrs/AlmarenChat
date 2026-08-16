import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { appendAgentRunEvent } from '@/app/api/_lib/agent-run-events';
import { getAgentRunForUser } from '@/app/api/_lib/agent-runs';
import { resolveAgent } from '@/app/api/_lib/spaces';
import { coordinatorStateAfterDispatchRejection } from '@/lib/agent-runtime-v3-policy.mjs';

const ACTIONS = new Set(['approve', 'reject']);

function cleanText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string; taskId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { runId, taskId } = await params;
    const body = await request.json();
    const action = typeof body.action === 'string' ? body.action : '';
    if (!ACTIONS.has(action)) {
      return NextResponse.json({ error: '不支持的派发审批操作' }, { status: 400 });
    }

    const existing = await getAgentRunForUser(runId, userId);
    if (!existing) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    const task = existing.tasks.find((item) => item.id === taskId);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (existing.status !== 'WAITING_APPROVAL' || task.status !== 'PROPOSED') {
      return NextResponse.json({ error: '当前派发提案已经处理或尚未进入待确认状态' }, { status: 409 });
    }

    const timestamp = new Date();
    if (action === 'reject') {
      const feedback = cleanText(body.feedback, 2_000);
      if (!feedback) return NextResponse.json({ error: '请说明拒绝这次派发的原因' }, { status: 400 });
      const nextCoordinatorState = coordinatorStateAfterDispatchRejection(existing.coordinatorState, {
        feedback,
        task,
        timestamp: timestamp.toISOString(),
      });
      await prisma.$transaction(async (transaction) => {
        const changed = await transaction.agentTask.updateMany({
          where: {
            runId,
            status: 'PROPOSED',
            ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
          },
          data: { status: 'CANCELLED', completedAt: timestamp },
        });
        if (changed.count === 0) throw new Error('当前派发提案已经处理');
        await transaction.agentRun.update({
          where: { id: runId },
          data: {
            status: 'QUEUED',
            completedAt: null,
            workerId: null,
            heartbeatAt: null,
            coordinatorState: nextCoordinatorState,
          },
        });
        await appendAgentRunEvent(transaction, runId, {
          type: 'TASK_DISPATCH_REJECTED',
          message: `已退回将“${task.title}”交给 ${task.agentName} 的提案，协调者将重新规划`,
          payload: { taskId, agentId: task.agentId, attempt: task.attempt, feedback },
          taskId,
          agentId: task.agentId,
          attempt: task.attempt,
          actor: 'user',
        });
      });
      return NextResponse.json({ run: await getAgentRunForUser(runId, userId) });
    }

    const revision = body.revision && typeof body.revision === 'object'
      ? body.revision as Record<string, unknown>
      : {};
    const agentId = cleanText(revision.agentId, 200) || task.agentId;
    const title = cleanText(revision.title, 160) || task.title;
    const instruction = cleanText(revision.instruction, 8_000) || task.instruction;
    const acceptanceCriteria = cleanText(revision.acceptanceCriteria, 4_000) || task.acceptanceCriteria || '';
    if (!title || !instruction || !acceptanceCriteria) {
      return NextResponse.json({ error: '任务标题、执行说明和验收标准不能为空' }, { status: 400 });
    }

    const membership = await prisma.spaceMember.findFirst({
      where: { spaceId: existing.spaceId, agentId },
    });
    if (!membership) return NextResponse.json({ error: '只能把任务交给当前空间成员' }, { status: 400 });
    const agent = await resolveAgent(agentId, userId);
    if (!agent) return NextResponse.json({ error: '所选空间成员不可用' }, { status: 400 });
    const busySession = await prisma.agentSession.findUnique({
      where: { spaceId_agentId: { spaceId: existing.spaceId, agentId } },
    });
    if (busySession?.status === 'WORKING') {
      return NextResponse.json({ error: `${agent.name} 当前仍有任务，请更换成员或稍后确认` }, { status: 409 });
    }

    const revised = agentId !== task.agentId
      || title !== task.title
      || instruction !== task.instruction
      || acceptanceCriteria !== (task.acceptanceCriteria || '');
    await prisma.$transaction(async (transaction) => {
      const changed = await transaction.agentTask.updateMany({
        where: { id: taskId, runId, status: 'PROPOSED' },
        data: {
          agentId,
          agentName: agent.name,
          title,
          instruction,
          acceptanceCriteria,
          status: 'PENDING',
          approvedAt: timestamp,
        },
      });
      if (changed.count !== 1) throw new Error('当前派发提案已经处理');
      await transaction.agentRun.update({
        where: { id: runId },
        data: {
          status: 'QUEUED',
          workerId: null,
          heartbeatAt: null,
          coordinatorState: {
            ...((existing.coordinatorState && typeof existing.coordinatorState === 'object')
              ? existing.coordinatorState as Record<string, unknown>
              : {}),
            phase: 'executing',
            currentTaskIds: [taskId],
            lastDecision: revised ? '用户调整并批准了协调者的派发提案。' : '用户批准了协调者的派发提案。',
          },
        },
      });
      await appendAgentRunEvent(transaction, runId, {
        type: 'TASK_DISPATCH_APPROVED',
        message: `${revised ? '已调整并确认' : '已确认'}将“${title}”交给 ${agent.name}`,
        payload: {
          taskId,
          agentId,
          attempt: task.attempt,
          revised,
          previousAgentId: task.agentId,
        },
        taskId,
        agentId,
        attempt: task.attempt,
        actor: 'user',
      });
    });

    return NextResponse.json({ run: await getAgentRunForUser(runId, userId) });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error.message === '当前派发提案已经处理') {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
