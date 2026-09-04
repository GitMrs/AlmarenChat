import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ experienceId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { experienceId } = await params;
    const experience = await prisma.assistantExperience.findFirst({
      where: { id: experienceId, userId },
      select: {
        id: true,
        messages: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, role: true, source: true, content: true, createdAt: true },
        },
      },
    });
    if (!experience) return NextResponse.json({ error: '经历摘要不存在' }, { status: 404 });
    return NextResponse.json({ experience });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
