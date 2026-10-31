import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { requireAgentMemoryAccess } from '@/app/api/_lib/agent-personal-memory';
import { prepareConversationContext } from '@/lib/memory/conversation-context';

// Browser model preparation only; never sends a model request from the server.
export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { conversationId } = await params;
    const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, userId, kind: 'AGENT' }, select: { agentId: true, contextMessageLimit: true } });
    if (!conversation?.agentId) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    await requireAgentMemoryAccess(userId, conversation.agentId);
    const body = await request.json();
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { modelContextWindow: true, contextMessageLimit: true } });
    if (typeof body.requiredSystem !== 'string' || body.requiredSystem.length > 100_000 || !(typeof body.currentContent === 'string' || Array.isArray(body.currentContent)) || JSON.stringify(body.currentContent).length > 20_000_000) return NextResponse.json({ error: '无效的上下文请求' }, { status: 400 });
    const maxMessages = Math.max(1, Math.min(80, Math.floor(Number(body.maxMessages) || conversation.contextMessageLimit || user?.contextMessageLimit || 40)));
    const optional = Array.isArray(body.optional) ? body.optional.slice(0, 8).filter(item => typeof item?.content === 'string' && item.content.length <= 100_000 && typeof item.name === 'string').map(item => ({ name: item.name.slice(0, 100), content: item.content })) : [];
    let excludeMessageIds: string[] = [];
    if (body.currentMessageId || body.reuseLastUserMessage === true) {
      const latest = await prisma.message.findFirst({ where: { conversationId, role: { in: ['user', 'assistant'] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, role: true, content: true } });
      const currentText = typeof body.currentContent === 'string' ? body.currentContent : body.currentContent.find(part => part.type === 'text')?.text;
      const matchesCurrent = latest?.content === currentText || (!latest?.content && Array.isArray(body.currentContent) && body.currentContent.some(part => part.type === 'image_url'));
      if (!latest || latest.role !== 'user' || (body.currentMessageId ? latest.id !== body.currentMessageId : !matchesCurrent)) return NextResponse.json({ error: '当前消息已更新，请重试' }, { status: 409 });
      excludeMessageIds = [latest.id];
    }
    const prepared = await prepareConversationContext({ userId, conversationId, maxMessages, excludeMessageIds, requiredSystem: body.requiredSystem, optional, currentMessage: { role: 'user', content: body.currentContent }, modelContextWindow: user?.modelContextWindow });
    return NextResponse.json({ messages: prepared.messages, contextManifest: prepared.manifest }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : 400 });
  }
}
