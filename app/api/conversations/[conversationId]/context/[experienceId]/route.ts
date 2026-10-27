import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { requireAgentMemoryAccess } from '@/app/api/_lib/agent-personal-memory';

export async function GET(request: Request, { params }: { params: Promise<{ conversationId: string; experienceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { conversationId, experienceId } = await params;
    const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, userId, kind: 'AGENT' } });
    if (!conversation?.agentId) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    await requireAgentMemoryAccess(userId, conversation.agentId);
    const experience = await prisma.agentExperience.findFirst({ where: { id: experienceId, userId, agentId: conversation.agentId, sourceType: 'CHAT', taskId: { startsWith: `chat:${conversationId}:` }, status: { not: 'DELETED' } } });
    if (!experience) return NextResponse.json({ error: '归档不存在' }, { status: 404 });
    const ids = Array.isArray(experience.tags) ? experience.tags.map(String).filter(tag => tag.startsWith('message:')).map(tag => tag.slice(8)) : [];
    const messages = await prisma.message.findMany({ where: { conversationId, id: { in: ids } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, role: true, content: true, createdAt: true } });
    return NextResponse.json({ experience: { id: experience.id, messages: messages.map(message => ({ ...message, source: 'WEB' })) } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : error.message === 'Agent not found' ? 404 : 500 });
  }
}
