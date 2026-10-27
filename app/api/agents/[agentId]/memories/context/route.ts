import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { agentChatArchiveState, requireAgentMemoryAccess } from '@/app/api/_lib/agent-personal-memory';
import { loadAgentMemoryContext } from '@/lib/agents/memory/agent-memory';

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    await requireAgentMemoryAccess(userId, agentId);
    const body = await request.json();
    const conversation = typeof body.conversationId === 'string' ? await prisma.conversation.findFirst({
      where: { id: body.conversationId, userId, agentId, kind: 'AGENT' }, select: { agentMode: true },
    }) : null;
    if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    if (conversation.agentMode !== 'MAIN') return NextResponse.json({ context: '' }, { headers: { 'Cache-Control': 'no-store' } });
    const [context, archiveState] = await Promise.all([
      loadAgentMemoryContext({ userId, agentId, query: typeof body.query === 'string' ? body.query.slice(0, 4_000) : '' }),
      agentChatArchiveState(userId, agentId, body.conversationId),
    ]);
    return NextResponse.json({ context, archivedThrough: archiveState.archivedThrough }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : error.message === 'Agent not found' ? 404 : 500 });
  }
}
