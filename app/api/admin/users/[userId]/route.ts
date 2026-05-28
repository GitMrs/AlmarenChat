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
    const { password } = await request.json();

    if (typeof password !== 'string' || password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
      select: { id: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const result = adminErrorResponse(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}
