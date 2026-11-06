import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { updatePersonalMemory } from '@/lib/memory/personal-memory-update.mjs';

export async function PATCH(request: Request, { params }: { params: Promise<{ memoryId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { memoryId } = await params;
    const memory = await updatePersonalMemory(prisma, 'assistantMemoryItem', { id: memoryId, userId }, await request.json());
    return NextResponse.json({ memory });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
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
