import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ACTIVE_AGENT_RUN_STATUSES } from '@/app/api/_lib/agent-runs';
import { getSpaceForUser } from '@/app/api/_lib/spaces';
import { createCollaborationState } from '@/lib/relay/collaboration.mjs';
import { createGomokuState } from '@/lib/relay/gomoku.mjs';

const ACTIVE_DISCUSSION_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_RESEARCH', 'CANCEL_REQUESTED'];
const ACTIVE_RELAY_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'CANCEL_REQUESTED'];

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    const relays = await prisma.spaceRelay.findMany({
      where: { spaceId, userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return NextResponse.json({ relays });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    const body = await request.json();
    const kind = typeof body.kind === 'string' ? body.kind.trim() : '';
    const goal = typeof body.goal === 'string' ? body.goal.trim().slice(0, 2000) : '';
    const approvalMode = body.approvalMode === 'EACH_TURN' ? 'EACH_TURN' : 'AUTO';
    const requestedIds = Array.isArray(body.participantIds) ? body.participantIds.map(String).filter(Boolean) : [];
    const memberIds = new Set(space.members.map((member) => member.agentId));
    const participantIds = [...new Set<string>(requestedIds)].filter((id) => memberIds.has(id));
    const requestedTurns = Math.trunc(Number(body.maxTurns) || (kind === 'gomoku' ? 60 : participantIds.length));
    const maxTurns = kind === 'gomoku'
      ? Math.min(225, Math.max(2, requestedTurns))
      : Math.min(12, Math.max(participantIds.length, requestedTurns));

    if (!['collaboration', 'gomoku'].includes(kind)) return NextResponse.json({ error: '不支持的接力类型' }, { status: 400 });
    if (!goal) return NextResponse.json({ error: '请输入接力目标' }, { status: 400 });
    if (participantIds.length < 2 || participantIds.length > 4) return NextResponse.json({ error: '接力需要选择 2 至 4 位空间成员' }, { status: 400 });
    if (kind === 'gomoku' && participantIds.length !== 2) return NextResponse.json({ error: '五子棋需要选择两位空间成员' }, { status: 400 });

    const [activeRun, activeDiscussion, activeRelay] = await Promise.all([
      prisma.agentRun.findFirst({ where: { spaceId, status: { in: ACTIVE_AGENT_RUN_STATUSES } }, select: { id: true } }),
      prisma.spaceDiscussion.findFirst({ where: { spaceId, status: { in: ACTIVE_DISCUSSION_STATUSES } }, select: { id: true } }),
      prisma.spaceRelay.findFirst({ where: { spaceId, status: { in: ACTIVE_RELAY_STATUSES } }, select: { id: true } }),
    ]);
    if (activeRun || activeDiscussion || activeRelay) {
      return NextResponse.json({ error: '当前已有任务、讨论或接力正在进行' }, { status: 409 });
    }

    const relay = await prisma.$transaction(async (tx) => {
      const concurrentRelay = await tx.spaceRelay.findFirst({
        where: { spaceId, status: { in: ACTIVE_RELAY_STATUSES } },
        select: { id: true },
      });
      if (concurrentRelay) throw new Error('当前已有接力正在进行');
      await tx.spaceMessage.create({ data: { spaceId, role: 'user', content: goal } });
      const created = await tx.spaceRelay.create({
        data: {
          spaceId,
          userId,
          kind,
          goal,
          participantIds,
          approvalMode,
          maxTurns,
          state: kind === 'gomoku'
            ? createGomokuState()
            : createCollaborationState(body.completionCriteria),
          transcript: [],
        },
      });
      await tx.space.update({ where: { id: spaceId }, data: { updatedAt: new Date() } });
      return created;
    });
    return NextResponse.json({ relay }, { status: 201 });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
