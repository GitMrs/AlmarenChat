import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { requireAgentMemoryAccess } from '@/app/api/_lib/agent-personal-memory';
import { isDuplicateMemory } from '@/lib/personal-assistant/memory-dedup.mjs';
import { deriveAgentGrowthState } from '@/lib/agents/growth/state.mjs';
import { personalMemoryType } from '@/lib/memory/memory-taxonomy.mjs';

export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    await requireAgentMemoryAccess(userId, agentId);
    const [memories, activities, archives, growthEvents] = await Promise.all([
      prisma.agentMemoryItem.findMany({ where: { userId, agentId, status: { in: ['ACTIVE', 'DISABLED', 'SUPERSEDED'] } }, orderBy: { updatedAt: 'desc' } }),
      // 分别保留近期活动和归档，避免大量对话归档挤占活动的展示数量。
      prisma.agentExperience.findMany({ where: { userId, agentId, spaceId: null, outcome: 'ACCEPTED', status: { not: 'DELETED' }, sourceType: { not: 'CHAT' } }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.agentExperience.findMany({ where: { userId, agentId, spaceId: null, outcome: 'ACCEPTED', status: { not: 'DELETED' }, sourceType: 'CHAT' }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.agentGrowthEvent.findMany({ where: { userId, agentId, scope: 'PERSONAL' }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    const experiences = [...activities, ...archives].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    return NextResponse.json({ memories, experiences, growthEvents, growthState: deriveAgentGrowthState(growthEvents) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : error.message === 'Agent not found' ? 404 : 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    await requireAgentMemoryAccess(userId, agentId);
    const body = await request.json();
    if (body.conversationId !== undefined) {
      const conversation = typeof body.conversationId === 'string' ? await prisma.conversation.findFirst({
        where: { id: body.conversationId, userId, agentId, kind: 'AGENT', agentMode: 'MAIN' }, select: { id: true },
      }) : null;
      if (!conversation) return NextResponse.json({ error: '仅主聊天可以保存长期记忆' }, { status: 400 });
    }
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content || content.length > 500) return NextResponse.json({ error: '记忆内容需为 1～500 字' }, { status: 400 });
    if (body.category === 'skill') return NextResponse.json({ error: '学习方法请保存到知识库' }, { status: 400 });
    const category = personalMemoryType(body.category ?? 'preference');
    if (!category) return NextResponse.json({ error: '该类型不属于长期记忆或行为规则，请保留在状态或经历中' }, { status: 400 });
    const factKey = typeof body.factKey === 'string' && body.factKey.trim() ? body.factKey.trim().slice(0, 120) : null;
    const evidenceQuote = typeof body.evidenceQuote === 'string' && body.evidenceQuote.trim() ? body.evidenceQuote.trim().slice(0, 500) : null;
    const requestedSourceMessageId = typeof body.sourceMessageId === 'string' && body.sourceMessageId.trim() ? body.sourceMessageId.trim().slice(0, 200) : null;
    const existing = await prisma.agentMemoryItem.findMany({ where: { userId, agentId, status: 'ACTIVE', category: { not: 'skill' } } });
    const duplicate = existing.find(item => isDuplicateMemory(content, [item.content]));
    if (duplicate) return NextResponse.json({ memory: duplicate, duplicate: true });
    const sourceMessage = requestedSourceMessageId ? await prisma.message.findFirst({
      where: { id: requestedSourceMessageId, role: 'user', conversation: { userId, agentId, kind: 'AGENT' } }, select: { id: true, content: true },
    }) : null;
    const sourceMessageId = sourceMessage && (!evidenceQuote || sourceMessage.content.includes(evidenceQuote)) ? sourceMessage.id : null;
    if (requestedSourceMessageId && !sourceMessageId) return NextResponse.json({ error: '记忆来源或原话证据无效，请重新提取后确认' }, { status: 400 });
    const memory = await prisma.$transaction(async (tx) => {
      const created = await tx.agentMemoryItem.create({ data: { userId, agentId, content, category, trustStatus: 'VERIFIED', confidence: 1, factKey, evidenceQuote, sourceMessageId } });
      if (factKey) {
        await tx.agentMemoryItem.updateMany({
          where: { userId, agentId, factKey, status: 'ACTIVE', id: { not: created.id } },
          data: { status: 'SUPERSEDED', supersededById: created.id },
        });
      }
      return created;
    });
    return NextResponse.json({ memory });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : error.message === 'Agent not found' ? 404 : 500 });
  }
}
