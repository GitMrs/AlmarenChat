import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/app/api/_lib/db';
import { adminErrorResponse, requireAdmin } from '@/app/api/_lib/admin';

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim();

    const users = await prisma.user.findMany({
      where: query
        ? {
            OR: [
              { email: { contains: query } },
              { name: { contains: query } },
            ],
          }
        : undefined,
      take: 50,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        customModelEnabled: true,
        dailyChatLimit: true,
        _count: { select: { agents: true, conversations: true } },
      },
    });

    return NextResponse.json({ users });
  } catch (error) {
    const result = adminErrorResponse(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const { email, password, name, dailyChatLimit } = await request.json();
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const displayName = typeof name === 'string' ? name.trim() : '';

    if (!normalizedEmail || !displayName || typeof password !== 'string' || password.length < 6) {
      return NextResponse.json({ error: 'Email, name and password are required' }, { status: 400 });
    }

    let parsedDailyChatLimit: number | null | undefined;
    if (dailyChatLimit !== undefined && dailyChatLimit !== null && dailyChatLimit !== '') {
      const limit = Number(dailyChatLimit);
      if (!Number.isFinite(limit) || limit < 0 || limit > 10000) {
        return NextResponse.json({ error: 'Daily chat limit must be between 0 and 10000' }, { status: 400 });
      }
      parsedDailyChatLimit = Math.floor(limit);
    } else if (dailyChatLimit === null || dailyChatLimit === '') {
      parsedDailyChatLimit = null;
    }

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } });
    if (existing) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: displayName,
        passwordHash,
        dailyChatLimit: parsedDailyChatLimit,
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        customModelEnabled: true,
        dailyChatLimit: true,
        _count: { select: { agents: true, conversations: true } },
      },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    const result = adminErrorResponse(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}
