import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { isDuplicateMemory } from '@/lib/personal-assistant/memory-dedup.mjs';

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const agentId = new URL(request.url).searchParams.get('agentId')?.trim() || null;
    const memories = await prisma.assistantMemoryItem.findMany({ where: { userId, ...(agentId ? { agentId } : { agentId: null }) }, orderBy: { updatedAt: 'desc' } });
    return NextResponse.json({ memories });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json();
    const agentId = typeof body.agentId === 'string' && body.agentId.trim() ? body.agentId.trim() : null;
    const content = typeof body.content === 'string' ? body.content.trim().slice(0, 500) : '';
    const category = typeof body.category === 'string' ? body.category.trim().slice(0, 40) : 'preference';
    if (!content) return NextResponse.json({ error: '记忆内容不能为空' }, { status: 400 });
    const existingMemories = await prisma.assistantMemoryItem.findMany({
      where: { userId, agentId, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
    });
    const duplicate = existingMemories.find((memory) => (
      isDuplicateMemory(content, [memory.content])
    ));
    if (duplicate) return NextResponse.json({ memory: duplicate, duplicate: true });
    const memory = await prisma.assistantMemoryItem.create({
      data: { id: randomUUID(), userId, agentId, category: category || 'preference', content, status: 'ACTIVE' },
    });
    return NextResponse.json({ memory, duplicate: false });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = requireAuth(request);
    const agentId = new URL(request.url).searchParams.get('agentId')?.trim() || null;
    await prisma.assistantMemoryItem.deleteMany({ where: { userId, ...(agentId ? { agentId } : { agentId: null }) } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
