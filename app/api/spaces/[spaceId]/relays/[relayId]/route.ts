import { NextResponse } from 'next/server';
import { Prisma } from '@/src/generated/prisma/client';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { relayStagePolicy } from '@/lib/relay/stage-policy.mjs';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; relayId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { spaceId, relayId } = await params;
    const relay = await prisma.spaceRelay.findFirst({ where: { id: relayId, spaceId, userId } });
    if (!relay) return NextResponse.json({ error: 'Relay not found' }, { status: 404 });

    const { action } = await request.json();
    if (action === 'cancel') {
      if (!['QUEUED', 'RUNNING', 'PAUSE_REQUESTED', 'WAITING_APPROVAL', 'PAUSED', 'CANCEL_REQUESTED'].includes(relay.status)) {
        return NextResponse.json({ relay });
      }
      const immediate = !['RUNNING', 'PAUSE_REQUESTED'].includes(relay.status);
      const updated = await prisma.spaceRelay.update({
        where: { id: relay.id },
        data: immediate
          ? { status: 'CANCELLED', completedAt: new Date(), pendingAction: Prisma.JsonNull }
          : { status: 'CANCEL_REQUESTED' },
      });
      return NextResponse.json({ relay: updated });
    }

    if (action === 'pause') {
      if (relay.status === 'PAUSED') return NextResponse.json({ relay });
      if (!['QUEUED', 'RUNNING'].includes(relay.status)) return NextResponse.json({ error: '当前状态不能暂停' }, { status: 409 });
      const changed = await prisma.spaceRelay.updateMany({
        where: { id: relay.id, status: relay.status },
        data: { status: relay.status === 'RUNNING' ? 'PAUSE_REQUESTED' : 'PAUSED', error: null },
      });
      if (!changed.count) return NextResponse.json({ error: '接力状态已经变化，请重试' }, { status: 409 });
      const updated = await prisma.spaceRelay.findUnique({ where: { id: relay.id } });
      return NextResponse.json({ relay: updated });
    }

    if (action === 'resume') {
      if (relay.status !== 'PAUSED') return NextResponse.json({ relay });
      const updated = await prisma.spaceRelay.update({ where: { id: relay.id }, data: { status: relay.pendingAction ? 'WAITING_APPROVAL' : 'QUEUED', error: null } });
      return NextResponse.json({ relay: updated });
    }

    const pending = relay.pendingAction && typeof relay.pendingAction === 'object'
      ? relay.pendingAction as Record<string, unknown>
      : null;
    if (pending?.type === 'stage_limit' && ['continue', 'stop'].includes(action)) {
      if (relay.status !== 'WAITING_APPROVAL') return NextResponse.json({ error: '对局状态已经变化' }, { status: 409 });
      const stage = relayStagePolicy(relay.kind);
      if (!stage) return NextResponse.json({ error: '该接力没有阶段续期规则' }, { status: 400 });
      if (action === 'continue') {
        const updated = await prisma.spaceRelay.update({
          where: { id: relay.id },
          data: { status: 'QUEUED', maxTurns: relay.maxTurns + stage.size, pendingAction: Prisma.JsonNull, error: null },
        });
        return NextResponse.json({ relay: updated });
      }
      const state = relay.state && typeof relay.state === 'object' ? relay.state as Record<string, unknown> : {};
      const updated = await prisma.$transaction(async (tx) => {
        const completed = await tx.spaceRelay.update({
          where: { id: relay.id },
          data: {
            status: 'COMPLETED',
            state: stage.stoppedState(state),
            result: stage.stoppedSummary(relay.turnCount),
            pendingAction: Prisma.JsonNull,
            completedAt: new Date(),
          },
        });
        await tx.spaceMessage.create({
          data: {
            spaceId,
            role: 'assistant',
            speakerAgentId: 'space-coordinator',
            content: completed.result || '对局已结束。',
            attachments: [{ type: 'relay_summary', relayId: relay.id }],
          },
        });
        return completed;
      });
      return NextResponse.json({ relay: updated });
    }

    if (!['approve', 'reject'].includes(action) || relay.status !== 'WAITING_APPROVAL') {
      return NextResponse.json({ error: 'Unsupported relay action' }, { status: 400 });
    }
    if (!pending) return NextResponse.json({ error: 'Pending action not found' }, { status: 404 });

    const changed = await prisma.spaceRelay.updateMany({
      where: { id: relay.id, status: 'WAITING_APPROVAL' },
      data: action === 'approve'
        ? {
            status: 'QUEUED',
            pendingAction: { ...pending, approved: true, ...(pending.type === 'coordinator_continue' ? { decision: 'continue' } : {}) },
            error: null,
          }
        : {
            status: 'QUEUED',
            pendingAction: pending.type === 'coordinator_continue'
              ? { ...pending, approved: true, decision: 'stop' }
              : { ...pending, approved: false, rejected: true },
            error: null,
          },
    });
    if (changed.count !== 1) return NextResponse.json({ error: '接力状态已经变化' }, { status: 409 });
    const updated = await prisma.spaceRelay.findUnique({ where: { id: relay.id } });
    return NextResponse.json({ relay: updated });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
