import { NextResponse } from 'next/server';
import { Prisma } from '@/src/generated/prisma/client';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

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
      if (!['QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'CANCEL_REQUESTED'].includes(relay.status)) {
        return NextResponse.json({ relay });
      }
      const immediate = relay.status !== 'RUNNING';
      const updated = await prisma.spaceRelay.update({
        where: { id: relay.id },
        data: immediate
          ? { status: 'CANCELLED', completedAt: new Date(), pendingAction: Prisma.JsonNull }
          : { status: 'CANCEL_REQUESTED' },
      });
      return NextResponse.json({ relay: updated });
    }

    if (!['approve', 'reject'].includes(action) || relay.status !== 'WAITING_APPROVAL') {
      return NextResponse.json({ error: 'Unsupported relay action' }, { status: 400 });
    }
    const pending = relay.pendingAction && typeof relay.pendingAction === 'object'
      ? relay.pendingAction as Record<string, unknown>
      : null;
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
