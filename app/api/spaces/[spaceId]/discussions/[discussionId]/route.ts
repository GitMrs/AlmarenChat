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

    const { action, scope, content } = await request.json();
    if (action === 'pause') {
      if (!['QUEUED', 'RUNNING'].includes(discussion.status)) return NextResponse.json({ discussion });
      const updated = await prisma.spaceDiscussion.update({
        where: { id: discussion.id },
        data: { status: discussion.status === 'RUNNING' ? 'PAUSE_REQUESTED' : 'PAUSED' },
      });
      return NextResponse.json({ discussion: updated });
    }
    if (action === 'resume') {
      if (discussion.status !== 'PAUSED') return NextResponse.json({ discussion });
      const updated = await prisma.spaceDiscussion.update({ where: { id: discussion.id }, data: { status: 'QUEUED', error: null } });
      return NextResponse.json({ discussion: updated });
    }
    if (action === 'continue') {
      if (discussion.status !== 'COMPLETED') return NextResponse.json({ error: '只有已完成的讨论可以继续' }, { status: 409 });
      const updated = await prisma.spaceDiscussion.update({
        where: { id: discussion.id },
        data: { status: 'QUEUED', maxRounds: { increment: 2 }, result: null, completedAt: null, error: null },
      });
      return NextResponse.json({ discussion: updated });
    }
    if (action === 'inject') {
      const message = typeof content === 'string' ? content.trim().slice(0, 4000) : '';
      if (!message) return NextResponse.json({ error: '插话内容不能为空' }, { status: 400 });
      if (!['QUEUED', 'RUNNING', 'PAUSED', 'PAUSE_REQUESTED', 'WAITING_RESEARCH'].includes(discussion.status)) {
        return NextResponse.json({ error: '当前讨论已经结束' }, { status: 409 });
      }
      const transcript = Array.isArray(discussion.transcript) ? discussion.transcript : [];
      const updated = await prisma.$transaction(async (tx) => {
        const next = await tx.spaceDiscussion.update({
          where: { id: discussion.id },
          data: { transcript: [...transcript, { type: 'user_interjection', content: message, createdAt: new Date().toISOString() }] },
        });
        await tx.spaceMessage.create({ data: { spaceId, role: 'user', content: message } });
        return next;
      });
      return NextResponse.json({ discussion: updated });
    }
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
