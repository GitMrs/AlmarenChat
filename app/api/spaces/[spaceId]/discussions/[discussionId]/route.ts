import { NextResponse } from 'next/server';
import { Prisma } from '@/src/generated/prisma/client';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; discussionId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { spaceId, discussionId } = await params;
    const discussion = await prisma.spaceDiscussion.findFirst({ where: { id: discussionId, spaceId, userId } });
    if (!discussion) return NextResponse.json({ error: 'Discussion not found' }, { status: 404 });

    const { action, scope } = await request.json();
    if (action === 'cancel') {
      if (!['QUEUED', 'RUNNING', 'WAITING_RESEARCH', 'CANCEL_REQUESTED'].includes(discussion.status)) {
        return NextResponse.json({ discussion });
      }
      const immediate = discussion.status !== 'RUNNING';
      const updated = await prisma.spaceDiscussion.update({
        where: { id: discussion.id },
        data: immediate
          ? { status: 'CANCELLED', completedAt: new Date(), pendingResearch: Prisma.JsonNull }
          : { status: 'CANCEL_REQUESTED' },
      });
      return NextResponse.json({ discussion: updated });
    }

    if (!['approve_research', 'reject_research'].includes(action) || discussion.status !== 'WAITING_RESEARCH') {
      return NextResponse.json({ error: 'Unsupported discussion action' }, { status: 400 });
    }

    const pending = discussion.pendingResearch && typeof discussion.pendingResearch === 'object'
      ? discussion.pendingResearch as Record<string, unknown>
      : null;
    if (!pending) return NextResponse.json({ error: 'Research request not found' }, { status: 404 });

    if (action === 'approve_research') {
      const updated = await prisma.spaceDiscussion.update({
        where: { id: discussion.id },
        data: {
          status: 'QUEUED',
          allowWeb: scope === 'discussion' ? true : discussion.allowWeb,
          pendingResearch: { ...pending, approved: true },
        },
      });
      return NextResponse.json({ discussion: updated });
    }

    const deniedContext = [
      discussion.researchContext,
      `用户拒绝了联网查询“${String(pending.query || '').slice(0, 300)}”。请使用现有资料继续，并明确说明未完成外部验证。`,
    ].filter(Boolean).join('\n\n');
    const updated = await prisma.spaceDiscussion.update({
      where: { id: discussion.id },
      data: {
        status: 'QUEUED',
        pendingResearch: Prisma.JsonNull,
        researchContext: deniedContext.slice(-20_000),
      },
    });
    return NextResponse.json({ discussion: updated });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
