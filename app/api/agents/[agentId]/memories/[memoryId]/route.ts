import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { requireAgentMemoryAccess } from '@/app/api/_lib/agent-personal-memory';
import { updatePersonalMemory } from '@/lib/memory/personal-memory-update.mjs';

export async function PATCH(request: Request, { params }: { params: Promise<{ agentId: string; memoryId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId, memoryId } = await params;
    await requireAgentMemoryAccess(userId, agentId);
    const memory = await updatePersonalMemory(prisma, 'agentMemoryItem', { id: memoryId, userId, agentId }, await request.json());
    return NextResponse.json({ memory });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.status || (error.message === 'Unauthorized' ? 401 : error.message === 'Agent not found' ? 404 : 500) });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ agentId: string; memoryId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId, memoryId } = await params;
    await requireAgentMemoryAccess(userId, agentId);
    const result = await prisma.agentMemoryItem.updateMany({ where: { id: memoryId, userId, agentId, status: { not: 'DELETED' } }, data: { status: 'DELETED' } });
    return NextResponse.json(result.count ? { success: true } : { error: '记忆不存在' }, { status: result.count ? 200 : 404 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : error.message === 'Agent not found' ? 404 : 500 });
  }
}
