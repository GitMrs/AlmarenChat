import { NextResponse } from 'next/server';
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
        _count: { select: { agents: true, conversations: true } },
      },
    });

    return NextResponse.json({ users });
  } catch (error) {
    const result = adminErrorResponse(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}
