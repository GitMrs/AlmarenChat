import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser } from '@/app/api/_lib/spaces';
import { getFollowUpQQAvailability } from '@/lib/space/follow-up-notifications';

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: '空间不存在' }, { status: 404 });
    if (space.templateId !== 'crypto-contract-trading') return NextResponse.json({ error: '仅合约空间支持自主复查' }, { status: 409 });
    const reminderDetails = { select: { status: true, qqDeliveredAt: true, qqDeliveryError: true } };
    const [active, recent, qqChannel] = await Promise.all([
      prisma.spaceFollowUp.findMany({ where: { spaceId, status: { in: ['PENDING', 'RUNNING'] } }, orderBy: { runAt: 'asc' }, take: 12, include: { qqReminder: reminderDetails } }),
      prisma.spaceFollowUp.findMany({ where: { spaceId, status: { in: ['COMPLETED', 'FAILED', 'CANCELLED'] } }, orderBy: { updatedAt: 'desc' }, take: 5, include: { qqReminder: reminderDetails } }),
      getFollowUpQQAvailability(userId),
    ]);
    return NextResponse.json({ tasks: [...active, ...recent].map(({ id, agentId, title, runAt, status, error, updatedAt, origin, reason, qqReminder }) => ({
      id, agentId, title, runAt, status, error, updatedAt, origin, reason,
      qqNotification: qqReminder ? { status: qqReminder.qqDeliveredAt ? 'SENT' : qqReminder.status === 'FAILED' ? 'FAILED' : qqReminder.status === 'CANCELLED' ? 'CANCELLED' : qqReminder.qqDeliveryError ? 'RETRYING' : 'PENDING', error: qqReminder.qqDeliveryError } : null,
    })), enabled: space.cryptoAutonomyEnabled, qqEnabled: space.cryptoFollowUpQQEnabled, qqChannel,
      schedulerEnabled: process.env.ENABLE_SPACE_FOLLOW_UPS !== 'false' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message === 'Unauthorized' ? 'Unauthorized' : '获取复查任务失败' }, { status: error.message === 'Unauthorized' ? 401 : 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: '空间不存在' }, { status: 404 });
    if (space.templateId !== 'crypto-contract-trading') return NextResponse.json({ error: '仅合约空间支持自主复查' }, { status: 409 });
    const body = await request.json();
    if (typeof body.qqEnabled === 'boolean') {
      if (body.qqEnabled) {
        const availability = await getFollowUpQQAvailability(userId);
        if (!availability.ready) return NextResponse.json({ error: availability.reason }, { status: 409 });
      }
      await prisma.$transaction(async tx => {
        await tx.space.update({ where: { id: spaceId }, data: { cryptoFollowUpQQEnabled: body.qqEnabled } });
        if (!body.qqEnabled) await cancelQueuedQQNotifications(tx, spaceId);
      });
      return NextResponse.json({ success: true, qqEnabled: body.qqEnabled });
    }
    if (typeof body.enabled === 'boolean') {
      if (body.enabled && process.env.ENABLE_SPACE_FOLLOW_UPS === 'false') return NextResponse.json({ error: '服务器已关闭自主复查' }, { status: 409 });
      await prisma.$transaction(async tx => {
        await tx.space.update({ where: { id: spaceId }, data: { cryptoAutonomyEnabled: body.enabled } });
        if (!body.enabled) {
          await tx.spaceFollowUp.updateMany({
            where: { spaceId, status: { in: ['PENDING', 'RUNNING'] } },
            data: { status: 'CANCELLED', claimToken: null, leaseUntil: null },
          });
          await cancelQueuedQQNotifications(tx, spaceId);
        }
      });
      return NextResponse.json({ success: true, enabled: body.enabled });
    }
    if (typeof body.id !== 'string' || !body.id) return NextResponse.json({ error: '缺少任务ID' }, { status: 400 });
    const changed = await prisma.spaceFollowUp.updateMany({
      where: { id: body.id, spaceId, status: { in: ['PENDING', 'RUNNING'] } },
      data: { status: 'CANCELLED', claimToken: null, leaseUntil: null },
    });
    return changed.count ? NextResponse.json({ success: true }) : NextResponse.json({ error: '任务不存在或已结束' }, { status: 404 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message === 'Unauthorized' ? 'Unauthorized' : '取消复查失败' }, { status: error.message === 'Unauthorized' ? 401 : 500 });
  }
}

async function cancelQueuedQQNotifications(tx: any, spaceId: string) {
  await tx.assistantReminder.updateMany({
    where: { qqDeliveredAt: null, status: 'PENDING', spaceFollowUp: { is: { spaceId } } },
    data: { status: 'CANCELLED', qqNextAttemptAt: null },
  });
}
