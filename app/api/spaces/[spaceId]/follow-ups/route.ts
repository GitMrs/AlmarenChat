import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser } from '@/app/api/_lib/spaces';
import { getFollowUpQQAvailability } from '@/lib/space/follow-up-notifications';
import { FOLLOW_UP_DEFAULT_MAX_CONTINUATIONS, FOLLOW_UP_MAX_CONTINUATIONS_SETTING, normalizeFollowUpLimit, supportsSpaceFollowUps } from '@/lib/space/follow-up-policy.mjs';

const reminderDetails = { select: { status: true, qqDeliveredAt: true, qqDeliveryError: true } };
const taskDetails = { id: true, agentId: true, title: true, runAt: true, status: true, error: true,
  updatedAt: true, origin: true, reason: true, chainDepth: true, maxChainDepth: true, domain: true, workId: true, workTitle: true,
  watchConditions: true, watchTriggeredAt: true, watchEvent: true, qqReminder: reminderDetails } as const;
function serializeTask({ id, agentId, title, runAt, status, error, updatedAt, origin, reason, chainDepth, maxChainDepth, domain, workId, workTitle, watchConditions, watchTriggeredAt, watchEvent, qqReminder }: any) {
  return {
    id, agentId, title, runAt, status, error, updatedAt, origin, reason, chainDepth, maxChainDepth, domain, workId, workTitle,
    watchConditions, watchTriggeredAt, watchEvent,
    qqNotification: qqReminder ? { status: qqReminder.qqDeliveredAt ? 'SENT' : qqReminder.status === 'FAILED' ? 'FAILED' : qqReminder.status === 'CANCELLED' ? 'CANCELLED' : qqReminder.qqDeliveryError ? 'RETRYING' : 'PENDING', error: qqReminder.qqDeliveryError } : null,
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: '空间不存在' }, { status: 404 });
    if (!supportsSpaceFollowUps(space)) return NextResponse.json({ error: '当前空间运行模式不支持自主跟进' }, { status: 409 });
    const settings = { maxContinuations: space.followUpMaxContinuations ?? FOLLOW_UP_DEFAULT_MAX_CONTINUATIONS,
      maxAllowedContinuations: FOLLOW_UP_MAX_CONTINUATIONS_SETTING };
    const search = new URL(request.url).searchParams;
    const workId = search.get('workId');
    if (workId && !await prisma.spaceWork.findFirst({ where: { id: workId, spaceId }, select: { id: true } })) {
      return NextResponse.json({ error: '关联成果不存在' }, { status: 404 });
    }
    const scope = { spaceId, ...(workId ? { workId } : {}) };
    const taskId = search.get('taskId');
    if (taskId) {
      const task = await prisma.spaceFollowUp.findFirst({ where: { id: taskId, ...scope }, select: taskDetails });
      if (!task) return NextResponse.json({ error: '复查记录不存在' }, { status: 404 });
      const report = await prisma.spaceFollowUpReport.findUnique({ where: { taskId: task.id }, select: { content: true, summary: true, createdAt: true } }) || await prisma.spaceMessage.findFirst({
        where: { spaceId, sourceKey: `space-follow-up:${task.id}` }, select: { content: true, createdAt: true },
      });
      return NextResponse.json({ task: serializeTask(task), report }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (search.get('view') === 'history') {
      const status = search.get('status') || 'ALL';
      if (!['ALL', 'ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(status)) {
        return NextResponse.json({ error: '无效的复查状态' }, { status: 400 });
      }
      const rawPage = Number(search.get('page') || '1');
      if (!Number.isSafeInteger(rawPage) || rawPage < 1) return NextResponse.json({ error: '无效的页码' }, { status: 400 });
      const pageSize = 20;
      const where = { ...scope, ...(status === 'ACTIVE' ? { status: { in: ['PENDING', 'RUNNING'] } }
        : status === 'ALL' ? {} : { status }) };
      const total = await prisma.spaceFollowUp.count({ where });
      const page = Math.min(rawPage, Math.max(1, Math.ceil(total / pageSize)));
      const tasks = await prisma.spaceFollowUp.findMany({ where, orderBy: [{ runAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize, take: pageSize, select: taskDetails });
      return NextResponse.json({ tasks: tasks.map(serializeTask), total, page, pageSize, settings, contractMode: space.templateId === 'crypto-contract-trading' }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const [active, recent, qqChannel] = await Promise.all([
      prisma.spaceFollowUp.findMany({ where: { ...scope, status: { in: ['PENDING', 'RUNNING'] } }, orderBy: { runAt: 'asc' }, take: 12, select: taskDetails }),
      prisma.spaceFollowUp.findMany({ where: { ...scope, status: { in: ['COMPLETED', 'FAILED', 'CANCELLED'] } }, orderBy: { updatedAt: 'desc' }, take: 5, select: taskDetails }),
      getFollowUpQQAvailability(userId),
    ]);
    return NextResponse.json({ tasks: [...active, ...recent].map(serializeTask), settings, contractMode: space.templateId === 'crypto-contract-trading', enabled: space.followUpEnabled, qqEnabled: space.followUpQQEnabled, qqChannel,
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
    if (!supportsSpaceFollowUps(space)) return NextResponse.json({ error: '当前空间运行模式不支持自主跟进' }, { status: 409 });
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: '无效的设置' }, { status: 400 });
    if ('maxContinuations' in body) {
      let maxContinuations: number;
      try { maxContinuations = normalizeFollowUpLimit(body.maxContinuations); }
      catch (error: any) { return NextResponse.json({ error: error.message }, { status: 400 }); }
      await prisma.space.update({ where: { id: spaceId }, data: { followUpMaxContinuations: maxContinuations } });
      return NextResponse.json({ success: true, maxContinuations });
    }
    if (typeof body.qqEnabled === 'boolean') {
      if (body.qqEnabled) {
        const availability = await getFollowUpQQAvailability(userId);
        if (!availability.ready) return NextResponse.json({ error: availability.reason }, { status: 409 });
      }
      await prisma.$transaction(async tx => {
        await tx.space.update({ where: { id: spaceId }, data: { followUpQQEnabled: body.qqEnabled } });
        if (!body.qqEnabled) await cancelQueuedQQNotifications(tx, spaceId);
      });
      return NextResponse.json({ success: true, qqEnabled: body.qqEnabled });
    }
    if (typeof body.enabled === 'boolean') {
      if (body.enabled && process.env.ENABLE_SPACE_FOLLOW_UPS === 'false') return NextResponse.json({ error: '服务器已关闭自主复查' }, { status: 409 });
      await prisma.$transaction(async tx => {
        await tx.space.update({ where: { id: spaceId }, data: { followUpEnabled: body.enabled } });
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
