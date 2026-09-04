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
    const sourceMessageId = typeof body.sourceMessageId === 'string' ? body.sourceMessageId.trim().slice(0, 100) : '';
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim().slice(0, 180) : '';
    const rawItems = Array.isArray(body.items) ? body.items.slice(0, 10) : [body];
    const items = rawItems.map((item: any, index: number) => {
      const content = typeof item?.content === 'string' ? item.content.trim().slice(0, 300) : '';
      let dueTime: Date | null = null;
      if (item?.dueTime) {
        const parsed = new Date(item.dueTime);
        if (!Number.isNaN(parsed.getTime())) dueTime = parsed;
      }
      return {
        content,
        dueTime,
        sourceMessageId: sourceMessageId || null,
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:${index}` : null,
      };
    }).filter((item: { content: string }) => item.content);
    if (!items.length) {
      return NextResponse.json({ error: '内容不能为空' }, { status: 400 });
    }

    const reminders = await prisma.$transaction(items.map((item) => (
      item.idempotencyKey
        ? prisma.assistantReminder.upsert({
          where: { userId_idempotencyKey: { userId, idempotencyKey: item.idempotencyKey } },
          update: {},
          create: { userId, content: item.content, dueTime: item.dueTime, sourceMessageId: item.sourceMessageId, idempotencyKey: item.idempotencyKey, status: 'PENDING' },
        })
        : prisma.assistantReminder.create({
          data: { userId, content: item.content, dueTime: item.dueTime, sourceMessageId: item.sourceMessageId, status: 'PENDING' },
        })
    )));
    const serialized = reminders.map((reminder) => ({
      id: reminder.id,
      content: reminder.content,
      dueTime: reminder.dueTime ? reminder.dueTime.toISOString() : null,
      status: reminder.status,
      sourceMessageId: reminder.sourceMessageId,
      createdAt: reminder.createdAt.toISOString(),
      updatedAt: reminder.updatedAt.toISOString(),
    }));

    return NextResponse.json({
      reminder: serialized[0],
      reminders: serialized,
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
      qqDeliveredAt?: null;
      qqMessageId?: null;
      qqDeliveryAttempts?: number;
      qqNextAttemptAt?: null;
      qqDeliveryError?: null;
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
    if (updateData.status === 'PENDING' || updateData.dueTime !== undefined) {
      updateData.qqDeliveredAt = null;
      updateData.qqMessageId = null;
      updateData.qqDeliveryAttempts = 0;
      updateData.qqNextAttemptAt = null;
      updateData.qqDeliveryError = null;
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
