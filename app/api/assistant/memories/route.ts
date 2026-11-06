import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { isDuplicateMemory } from '@/lib/personal-assistant/memory-dedup.mjs';
import { personalMemoryType } from '@/lib/memory/memory-taxonomy.mjs';

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const agentId = new URL(request.url).searchParams.get('agentId')?.trim() || null;
    const memories = await prisma.assistantMemoryItem.findMany({ where: { userId, status: { in: ['ACTIVE', 'DISABLED', 'SUPERSEDED'] }, ...(agentId ? { agentId } : { agentId: null }) }, orderBy: { updatedAt: 'desc' } });
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
    const category = personalMemoryType(body.category ?? 'preference');
    if (!category) return NextResponse.json({ error: '该类型不属于长期记忆或行为规则，请保留在状态或经历中' }, { status: 400 });
    const factKey = typeof body.factKey === 'string' && body.factKey.trim() ? body.factKey.trim().slice(0, 120) : null;
    const evidenceQuote = typeof body.evidenceQuote === 'string' && body.evidenceQuote.trim() ? body.evidenceQuote.trim().slice(0, 500) : null;
    const requestedSourceMessageId = typeof body.sourceMessageId === 'string' && body.sourceMessageId.trim() ? body.sourceMessageId.trim().slice(0, 200) : null;
    if (!content) return NextResponse.json({ error: '记忆内容不能为空' }, { status: 400 });
    const existingMemories = await prisma.assistantMemoryItem.findMany({
      where: { userId, agentId, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
    });
    const duplicate = existingMemories.find((memory) => (
      isDuplicateMemory(content, [memory.content])
    ));
    if (duplicate) return NextResponse.json({ memory: duplicate, duplicate: true });
    const sourceMessage = requestedSourceMessageId ? await prisma.message.findFirst({
      where: { id: requestedSourceMessageId, role: 'user', conversation: agentId ? { userId, agentId, kind: 'AGENT', agentMode: 'MAIN' } : { userId, kind: 'PERSONAL_ASSISTANT', assistantMode: 'MAIN' } }, select: { id: true, content: true },
    }) : null;
    const sourceMessageId = sourceMessage && (!evidenceQuote || sourceMessage.content.includes(evidenceQuote)) ? sourceMessage.id : null;
    if (requestedSourceMessageId && !sourceMessageId) return NextResponse.json({ error: '记忆来源或原话证据无效，请重新提取后确认' }, { status: 400 });
    const memory = await prisma.$transaction(async (tx) => {
      const created = await tx.assistantMemoryItem.create({
        data: { id: randomUUID(), userId, agentId, category: category || 'preference', content, status: 'ACTIVE', trustStatus: 'VERIFIED', confidence: 1, factKey, evidenceQuote, sourceMessageId },
      });
      if (factKey) {
        await tx.assistantMemoryItem.updateMany({
          where: { userId, agentId, factKey, status: 'ACTIVE', id: { not: created.id } },
          data: { status: 'SUPERSEDED', supersededById: created.id },
        });
      }
      return created;
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
