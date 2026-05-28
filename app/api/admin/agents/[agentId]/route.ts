import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { adminErrorResponse, requireAdmin } from '@/app/api/_lib/admin';

export async function PATCH(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    await requireAdmin(request);
    const { agentId } = await params;
    const body = await request.json();

    if (typeof body.isPublic !== 'boolean') {
      return NextResponse.json({ error: 'Missing isPublic' }, { status: 400 });
    }

    const agent = await prisma.agent.update({
      where: { id: agentId },
      data: { isPublic: body.isPublic },
      include: {
        creator: { select: { id: true, email: true, name: true } },
      },
    });

    return NextResponse.json({ agent });
  } catch (error) {
    const result = adminErrorResponse(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    await requireAdmin(request);
    const { agentId } = await params;

    await prisma.favoriteAgent.deleteMany({ where: { agentId } });
    await prisma.agent.delete({ where: { id: agentId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    const result = adminErrorResponse(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}
