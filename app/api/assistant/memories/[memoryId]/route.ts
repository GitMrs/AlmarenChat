import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

export async function PATCH(request: Request, { params }: { params: Promise<{ memoryId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { memoryId } = await params;
    const existing = await prisma.assistantMemoryItem.findFirst({ where: { id: memoryId, userId } });
    if (!existing) return NextResponse.json({ error: '记忆不存在' }, { status: 404 });
    const body = await request.json();
    const content = typeof body.content === 'string' ? body.content.trim().slice(0, 500) : undefined;
    const status = ['ACTIVE', 'DISABLED'].includes(body.status) ? body.status : undefined;
    if (content === '') return NextResponse.json({ error: '记忆内容不能为空' }, { status: 400 });
    const memory = await prisma.assistantMemoryItem.update({
      where: { id: memoryId },
      data: { ...(content !== undefined ? { content } : {}), ...(status ? { status } : {}) },
    });
    return NextResponse.json({ memory });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ memoryId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { memoryId } = await params;
    const result = await prisma.assistantMemoryItem.deleteMany({ where: { id: memoryId, userId } });
    if (!result.count) return NextResponse.json({ error: '记忆不存在' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
