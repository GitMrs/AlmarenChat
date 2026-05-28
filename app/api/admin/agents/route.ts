import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { adminErrorResponse, requireAdmin } from '@/app/api/_lib/admin';

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim();

    const agents = await prisma.agent.findMany({
      where: query
        ? {
            OR: [
              { name: { contains: query } },
              { description: { contains: query } },
              { category: { contains: query } },
            ],
          }
        : undefined,
      take: 80,
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { id: true, email: true, name: true } },
      },
    });

    return NextResponse.json({ agents });
  } catch (error) {
    const result = adminErrorResponse(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}
