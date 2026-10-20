import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { requireAgentMemoryAccess } from '@/app/api/_lib/agent-personal-memory';

export async function PATCH(request: Request, { params }: { params: Promise<{ agentId: string; memoryId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId, memoryId } = await params;
    await requireAgentMemoryAccess(userId, agentId);
    const body = await request.json();
    const content = body.content === undefined ? undefined : typeof body.content === 'string' ? body.content.trim() : '';
    if (content !== undefined && (!content || content.length > 500)) return NextResponse.json({ error: '记忆内容需为 1～500 字' }, { status: 400 });
    if (body.status !== undefined && !['ACTIVE', 'DISABLED'].includes(body.status)) return NextResponse.json({ error: '无效的记忆状态' }, { status: 400 });
    const updated = await prisma.agentMemoryItem.updateMany({ where: { id: memoryId, userId, agentId, status: { not: 'DELETED' } }, data: { ...(content !== undefined ? { content } : {}), ...(body.status ? { status: body.status } : {}) } });
    if (!updated.count) return NextResponse.json({ error: '记忆不存在' }, { status: 404 });
    return NextResponse.json({ memory: await prisma.agentMemoryItem.findFirst({ where: { id: memoryId, userId, agentId } }) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : error.message === 'Agent not found' ? 404 : 500 });
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
