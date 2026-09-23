import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { appendAgentRunEvent } from '@/app/api/_lib/agent-run-events';
import { getAgentRunForUser } from '@/app/api/_lib/agent-runs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { runId } = await params;
    const body = await request.json();
    const approved = body?.approved === true;
    const existing = await getAgentRunForUser(runId, userId);
    if (!existing) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    if (existing.status !== 'WAITING_APPROVAL') return NextResponse.json({ error: '当前任务不在等待联网确认状态' }, { status: 409 });

    const state = existing.coordinatorState && typeof existing.coordinatorState === 'object'
      ? existing.coordinatorState as Record<string, unknown>
      : {};
    if (!state.pendingNetworkRequest) return NextResponse.json({ error: '当前任务没有待处理的联网申请' }, { status: 409 });
    const timestamp = new Date();
    const nextState = {
      ...state,
      pendingNetworkRequest: null,
      authorization: {
        ...(state.authorization && typeof state.authorization === 'object' ? state.authorization as Record<string, unknown> : {}),
        networkDecision: approved ? 'allowed' : 'denied',
      },
    };
    await prisma.$transaction(async (transaction) => {
      await transaction.agentRun.update({
        where: { id: runId },
        data: { status: 'QUEUED', workerId: null, heartbeatAt: null, coordinatorState: nextState, updatedAt: timestamp },
      });
      await appendAgentRunEvent(transaction, runId, {
        type: approved ? 'WEB_SEARCH_APPROVED' : 'WEB_SEARCH_DENIED',
        message: approved ? '用户已允许本轮联网查询，任务将继续执行' : '用户已拒绝本轮联网查询，任务将继续使用现有资料',
        payload: { approved, actor: 'user' },
        actor: 'user',
      });
    });
    return NextResponse.json({ run: await getAgentRunForUser(runId, userId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '联网确认失败' }, { status: 400 });
  }
}
