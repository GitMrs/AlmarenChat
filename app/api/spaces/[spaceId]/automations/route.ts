import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser } from '@/app/api/_lib/spaces';
import { initialAutomationRunAt, normalizeAutomationCompletion, normalizeAutomationSchedule } from '@/lib/space-automation-policy.mjs';

function parseDate(value: unknown, fallback: Date) {
  if (value === undefined || value === null || value === '') return fallback;
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error('下次执行时间无效');
  return date;
}

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const automations = await prisma.spaceAutomation.findMany({
      where: { spaceId, deletedAt: null },
      include: {
        executions: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { run: { select: { status: true, result: true, error: true, completedAt: true } } },
        },
      },
      orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }],
    });
    return NextResponse.json({ automations });
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
    if (space.runtimeType === 'PI_CODING') return NextResponse.json({ error: '旧版 Pi 空间暂不支持自动化' }, { status: 409 });
    if (space.members.length === 0) return NextResponse.json({ error: '请先添加至少一名空间成员' }, { status: 400 });
    const body = await request.json();
    const name = String(body?.name || '').trim();
    const prompt = String(body?.prompt || '').trim();
    if (!name || name.length > 80) return NextResponse.json({ error: '自动化名称必须为 1 到 80 字' }, { status: 400 });
    if (!prompt || prompt.length > 12_000) return NextResponse.json({ error: '任务要求必须为 1 到 12000 字' }, { status: 400 });
    const schedule = normalizeAutomationSchedule(body);
    const workStrategy = body?.workStrategy === 'ACTIVE_WORK' ? 'ACTIVE_WORK' : 'NEW_WORK';
    const networkPolicy = ['forbidden', 'allowed', 'required'].includes(body?.networkPolicy) ? body.networkPolicy : 'forbidden';
    const completion = normalizeAutomationCompletion(body, space.templateId);
    const nextRunAt = parseDate(body?.nextRunAt, initialAutomationRunAt(schedule));
    const automation = await prisma.spaceAutomation.create({
      data: {
        spaceId,
        name,
        prompt,
        ...schedule,
        workStrategy,
        networkPolicy,
        ...completion,
        enabled: body?.enabled === true,
        nextRunAt,
      },
      include: { executions: true },
    });
    return NextResponse.json({ automation }, { status: 201 });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
