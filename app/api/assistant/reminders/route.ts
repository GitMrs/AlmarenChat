import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);

    // 获取未完成待办（PENDING）以及今天完成的待办（COMPLETED）
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const reminders = await prisma.assistantReminder.findMany({
      where: {
        userId,
        OR: [
          { status: 'PENDING' },
          { status: 'COMPLETED', updatedAt: { gte: todayStart } },
        ],
      },
      orderBy: [
        { status: 'desc' }, // PENDING starts before COMPLETED ('PENDING' > 'COMPLETED')
        { dueTime: 'asc' },
        { createdAt: 'desc' },
      ],
      take: 50,
    });

    return NextResponse.json({
      reminders: reminders.map((r) => ({
        id: r.id,
        content: r.content,
        dueTime: r.dueTime ? r.dueTime.toISOString() : null,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json().catch(() => ({}));
    const content = typeof body.content === 'string' ? body.content.trim().slice(0, 300) : '';
    if (!content) {
      return NextResponse.json({ error: '内容不能为空' }, { status: 400 });
    }

    let dueTime: Date | null = null;
    if (body.dueTime) {
      const parsed = new Date(body.dueTime);
      if (!Number.isNaN(parsed.getTime())) {
        dueTime = parsed;
      }
    }

    const reminder = await prisma.assistantReminder.create({
      data: {
        userId,
        content,
        dueTime,
        status: 'PENDING',
      },
    });

    return NextResponse.json({
      reminder: {
        id: reminder.id,
        content: reminder.content,
        dueTime: reminder.dueTime ? reminder.dueTime.toISOString() : null,
        status: reminder.status,
        createdAt: reminder.createdAt.toISOString(),
        updatedAt: reminder.updatedAt.toISOString(),
      },
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) {
      return NextResponse.json({ error: '缺少 id' }, { status: 400 });
    }

    const existing = await prisma.assistantReminder.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: '提醒不存在' }, { status: 404 });
    }

    const updateData: {
      status?: string;
      dueTime?: Date | null;
      content?: string;
    } = {};

    if (body.status && ['PENDING', 'COMPLETED', 'DISMISSED'].includes(body.status)) {
      updateData.status = body.status;
    }
    if (body.snoozeMinutes && typeof body.snoozeMinutes === 'number') {
      const base = existing.dueTime && existing.dueTime > new Date() ? existing.dueTime : new Date();
      updateData.dueTime = new Date(base.getTime() + body.snoozeMinutes * 60 * 1000);
      updateData.status = 'PENDING';
    } else if (body.dueTime !== undefined) {
      updateData.dueTime = body.dueTime ? new Date(body.dueTime) : null;
    }
    if (typeof body.content === 'string' && body.content.trim()) {
      updateData.content = body.content.trim().slice(0, 300);
    }

    const updated = await prisma.assistantReminder.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      reminder: {
        id: updated.id,
        content: updated.content,
        dueTime: updated.dueTime ? updated.dueTime.toISOString() : null,
        status: updated.status,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = requireAuth(request);
    const url = new URL(request.url);
    let id = url.searchParams.get('id');
    if (!id) {
      const body = await request.json().catch(() => ({}));
      id = body.id;
    }
    if (!id) {
      return NextResponse.json({ error: '缺少 id' }, { status: 400 });
    }

    await prisma.assistantReminder.deleteMany({
      where: { id, userId },
    });

    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
