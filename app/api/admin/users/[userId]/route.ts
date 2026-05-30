import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/app/api/_lib/db';
import { adminErrorResponse, requireAdmin } from '@/app/api/_lib/admin';

export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    await requireAdmin(request);
    const { userId } = await params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        apiBaseUrl: true,
        modelName: true,
        customModelEnabled: true,
        defaultStyle: true,
        contextMessageLimit: true,
        dailyChatLimit: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { agents: true, conversations: true } },
        agents: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            avatar: true,
            category: true,
            isPublic: true,
            createdAt: true,
          },
        },
        conversations: {
          take: 10,
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true,
            title: true,
            agentName: true,
            updatedAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error) {
    const result = adminErrorResponse(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    await requireAdmin(request);
    const { userId } = await params;
    const { password, dailyChatLimit } = await request.json();

    const data: { passwordHash?: string; dailyChatLimit?: number | null } = {};

    if (password !== undefined) {
      if (typeof password !== 'string' || password.length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
      }

      data.passwordHash = await bcrypt.hash(password, 10);
    }

    if (dailyChatLimit !== undefined) {
      if (dailyChatLimit === null || dailyChatLimit === '') {
        data.dailyChatLimit = null;
      } else {
        const limit = Number(dailyChatLimit);
        if (!Number.isFinite(limit) || limit < 0 || limit > 10000) {
          return NextResponse.json({ error: 'Daily chat limit must be between 0 and 10000' }, { status: 400 });
        }
        data.dailyChatLimit = Math.floor(limit);
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const result = adminErrorResponse(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const admin = await requireAdmin(request);
    const { userId } = await params;

    if (admin.id === userId) {
      return NextResponse.json({ error: 'You cannot delete yourself' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const conversations = await prisma.conversation.findMany({
      where: { userId },
      select: { id: true },
    });
    const conversationIds = conversations.map((conversation) => conversation.id);

    await prisma.$transaction([
      prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } }),
      prisma.conversation.deleteMany({ where: { userId } }),
      prisma.favoriteAgent.deleteMany({ where: { userId } }),
      prisma.dailyChatUsage.deleteMany({ where: { userId } }),
      prisma.agent.deleteMany({ where: { creatorId: userId } }),
      prisma.user.delete({ where: { id: userId } }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    const result = adminErrorResponse(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}
