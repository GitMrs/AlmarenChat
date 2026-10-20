import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { loadAgentWorldContext } from '@/lib/world/context';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { conversationId } = await params;
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId, kind: 'AGENT' }, select: { agentId: true },
    });
    if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    const body = await request.json().catch(() => null);
    if (typeof body?.query !== 'string' || body.query.length > 20_000) {
      return NextResponse.json({ error: '无效的查询内容' }, { status: 400 });
    }
    const history = await prisma.message.findMany({
      where: { conversationId, role: 'user' }, orderBy: { createdAt: 'desc' }, take: 3,
      select: { role: true, content: true },
    });
    const context = await loadAgentWorldContext({ agentId: conversation.agentId, query: body.query, history: history.reverse() });
    return NextResponse.json({ context }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === 'Unauthorized';
    return NextResponse.json({ error: unauthorized ? 'Unauthorized' : '世界事件资料暂不可用' }, { status: unauthorized ? 401 : 500 });
  }
}
