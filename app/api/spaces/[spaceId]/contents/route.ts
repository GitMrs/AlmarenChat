import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ACTIVE_AGENT_RUN_STATUSES } from '@/app/api/_lib/agent-runs';
import { ensureSpaceRoot, spaceRoot } from '@/app/api/_lib/spaces';
import { resetSpaceContentsStorage } from '@/lib/space-content-reset.mjs';

const ACTIVE_DISCUSSION_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_RESEARCH', 'CANCEL_REQUESTED'];

export async function DELETE(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await prisma.space.findFirst({ where: { id: spaceId, userId }, select: { id: true } });
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    const [activeRun, activeDiscussion] = await Promise.all([
      prisma.agentRun.findFirst({
        where: { spaceId, status: { in: ACTIVE_AGENT_RUN_STATUSES } },
        select: { id: true },
      }),
      prisma.spaceDiscussion.findFirst({
        where: { spaceId, status: { in: ACTIVE_DISCUSSION_STATUSES } },
        select: { id: true },
      }),
    ]);
    if (activeRun || activeDiscussion) {
      return NextResponse.json({ error: '空间仍有任务或讨论正在运行，请先停止后再清空' }, { status: 409 });
    }

    const deleted = await resetSpaceContentsStorage(spaceRoot(userId, spaceId), async () => {
      const [messages, files, memories, sessions, discussions, runs] = await prisma.$transaction([
        prisma.spaceMessage.deleteMany({ where: { spaceId } }),
        prisma.spaceFile.deleteMany({ where: { spaceId } }),
        prisma.spaceMemory.deleteMany({ where: { spaceId } }),
        prisma.agentSession.deleteMany({ where: { spaceId } }),
        prisma.spaceDiscussion.deleteMany({ where: { spaceId } }),
        prisma.agentRun.deleteMany({ where: { spaceId } }),
      ]);
      return {
        messages: messages.count,
        files: files.count,
        memories: memories.count,
        sessions: sessions.count,
        discussions: discussions.count,
        runs: runs.count,
      };
    }, { preserveEntries: ['.space'] });
    await ensureSpaceRoot(userId, spaceId);

    return NextResponse.json({ success: true, deleted });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
