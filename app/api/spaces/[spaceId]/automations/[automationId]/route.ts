import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { initialAutomationRunAt, normalizeAutomationCompletion, normalizeAutomationSchedule } from '@/lib/space-automation-policy.mjs';

async function ownedAutomation(spaceId: string, automationId: string, userId: string) {
  return prisma.spaceAutomation.findFirst({
    where: { id: automationId, spaceId, deletedAt: null, space: { userId } },
    include: { space: { select: { templateId: true } } },
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ spaceId: string; automationId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId, automationId } = await params;
    const automation = await ownedAutomation(spaceId, automationId, userId);
    if (!automation) return NextResponse.json({ error: '自动化不存在' }, { status: 404 });
    const body = await request.json();
    const data: Record<string, unknown> = {};
    if (body?.name !== undefined) {
      const name = String(body.name || '').trim();
      if (!name || name.length > 80) return NextResponse.json({ error: '自动化名称必须为 1 到 80 字' }, { status: 400 });
      data.name = name;
    }
    if (body?.prompt !== undefined) {
      const prompt = String(body.prompt || '').trim();
      if (!prompt || prompt.length > 12_000) return NextResponse.json({ error: '任务要求必须为 1 到 12000 字' }, { status: 400 });
      data.prompt = prompt;
    }
    const scheduleChanged = ['scheduleType', 'intervalMinutes', 'timeZone', 'scheduleHour', 'scheduleMinute', 'weekdays']
      .some((field) => body?.[field] !== undefined);
    if (scheduleChanged) {
      const currentWeekdays = Array.isArray(automation.weekdays) ? automation.weekdays : [];
      const schedule = normalizeAutomationSchedule(body, { ...automation, weekdays: currentWeekdays });
      Object.assign(data, schedule);
      if (body?.nextRunAt === undefined) data.nextRunAt = initialAutomationRunAt(schedule);
    }
    if (body?.workStrategy !== undefined) {
      if (!['NEW_WORK', 'ACTIVE_WORK'].includes(body.workStrategy)) return NextResponse.json({ error: '成果策略无效' }, { status: 400 });
      data.workStrategy = body.workStrategy;
    }
    if (body?.networkPolicy !== undefined) {
      if (!['forbidden', 'allowed', 'required'].includes(body.networkPolicy)) return NextResponse.json({ error: '联网策略无效' }, { status: 400 });
      data.networkPolicy = body.networkPolicy;
    }
    if (body?.completionAction !== undefined || body?.completionConfig !== undefined) {
      Object.assign(data, normalizeAutomationCompletion(body, automation.space.templateId, automation));
    }
    if (body?.enabled !== undefined) data.enabled = body.enabled === true;
    if (body?.nextRunAt !== undefined) {
      const nextRunAt = new Date(String(body.nextRunAt));
      if (!Number.isFinite(nextRunAt.getTime())) return NextResponse.json({ error: '下次执行时间无效' }, { status: 400 });
      data.nextRunAt = nextRunAt;
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ error: '没有可更新的自动化字段' }, { status: 400 });
    const updated = await prisma.spaceAutomation.update({
      where: { id: automationId },
      data,
      include: {
        executions: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { run: { select: { status: true, result: true, error: true, completedAt: true } } },
        },
      },
    });
    return NextResponse.json({ automation: updated });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ spaceId: string; automationId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId, automationId } = await params;
    const automation = await ownedAutomation(spaceId, automationId, userId);
    if (!automation) return NextResponse.json({ error: '自动化不存在' }, { status: 404 });
    await prisma.spaceAutomation.update({
      where: { id: automationId },
      data: { enabled: false, deletedAt: new Date() },
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
