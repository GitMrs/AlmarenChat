import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ACTIVE_AGENT_RUN_STATUSES } from '@/app/api/_lib/agent-runs';
import { ensureSpaceRoot, spaceRoot } from '@/app/api/_lib/spaces';
import { resetSpaceContentsStorage } from '@/lib/space/space-content-reset.mjs';

const ACTIVE_DISCUSSION_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_RESEARCH', 'CANCEL_REQUESTED'];
const ACTIVE_RELAY_STATUSES = ['QUEUED', 'RUNNING', 'PAUSE_REQUESTED', 'WAITING_APPROVAL', 'PAUSED', 'CANCEL_REQUESTED'];

export async function DELETE(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await prisma.space.findFirst({ where: { id: spaceId, userId }, select: { id: true } });
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    const [activeRun, activeDiscussion, activeRelay] = await Promise.all([
      prisma.agentRun.findFirst({
        where: { spaceId, status: { in: ACTIVE_AGENT_RUN_STATUSES } },
        select: { id: true },
      }),
      prisma.spaceDiscussion.findFirst({
        where: { spaceId, status: { in: ACTIVE_DISCUSSION_STATUSES } },
        select: { id: true },
      }),
      prisma.spaceRelay.findFirst({
        where: { spaceId, status: { in: ACTIVE_RELAY_STATUSES } },
        select: { id: true },
      }),
    ]);
    if (activeRun || activeDiscussion || activeRelay) {
      return NextResponse.json({ error: '空间仍有任务、讨论或接力正在运行，请先停止后再清空' }, { status: 409 });
    }

    const deleted = await resetSpaceContentsStorage(spaceRoot(userId, spaceId), async () => {
      const [, followUps, messages, files, memories, sessions, discussions, relays, runs, works] = await prisma.$transaction([
        prisma.assistantReminder.updateMany({
          where: { userId, status: 'PENDING', qqDeliveredAt: null, spaceFollowUp: { is: { spaceId } } },
          data: { status: 'CANCELLED', qqNextAttemptAt: null },
        }),
        // 删除跟进会级联删除完整报告，同时让执行中的租约无法再发布结果。
        prisma.spaceFollowUp.deleteMany({ where: { spaceId } }),
        prisma.spaceMessage.deleteMany({ where: { spaceId } }),
        prisma.spaceFile.deleteMany({ where: { spaceId } }),
        prisma.spaceMemory.deleteMany({ where: { spaceId } }),
        prisma.agentSession.deleteMany({ where: { spaceId } }),
        prisma.spaceDiscussion.deleteMany({ where: { spaceId } }),
        prisma.spaceRelay.deleteMany({ where: { spaceId } }),
        prisma.agentRun.deleteMany({ where: { spaceId } }),
        prisma.spaceWork.deleteMany({ where: { spaceId } }),
      ]);
      return {
        followUps: followUps.count,
        messages: messages.count,
        files: files.count,
        memories: memories.count,
        sessions: sessions.count,
        discussions: discussions.count,
        relays: relays.count,
        runs: runs.count,
        works: works.count,
      };
    }, { preserveEntries: ['.space'] });
    await prisma.space.update({ where: { id: spaceId }, data: { activeWorkId: null } });
    await ensureSpaceRoot(userId, spaceId);

    return NextResponse.json({ success: true, deleted });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
