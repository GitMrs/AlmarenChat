import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { requireAgentMemoryAccess } from '@/app/api/_lib/agent-personal-memory';
import { isDuplicateMemory } from '@/lib/personal-assistant/memory-dedup.mjs';
import { deriveAgentGrowthState } from '@/lib/agents/growth/state.mjs';

export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    await requireAgentMemoryAccess(userId, agentId);
    const [memories, experiences, growthEvents] = await Promise.all([
      prisma.agentMemoryItem.findMany({ where: { userId, agentId, status: { not: 'DELETED' } }, orderBy: { updatedAt: 'desc' } }),
      // 这是个人 Agent 档案，只展示没有空间归属的经历；空间经历由空间接口按 spaceId 读取。
      prisma.agentExperience.findMany({ where: { userId, agentId, spaceId: null, outcome: 'ACCEPTED', status: { not: 'DELETED' } }, orderBy: { updatedAt: 'desc' }, take: 50 }),
      prisma.agentGrowthEvent.findMany({ where: { userId, agentId, scope: 'PERSONAL' }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
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
    const category = ['preference', 'tech', 'rule', 'project', 'fact', 'skill'].includes(body.category) ? body.category : 'preference';
    const existing = await prisma.agentMemoryItem.findMany({ where: { userId, agentId, status: 'ACTIVE' } });
    const duplicate = existing.find(item => isDuplicateMemory(content, [item.content]));
    if (duplicate) return NextResponse.json({ memory: duplicate, duplicate: true });
    const memory = await prisma.agentMemoryItem.create({ data: { userId, agentId, content, category } });
    return NextResponse.json({ memory });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : error.message === 'Agent not found' ? 404 : 500 });
  }
}
