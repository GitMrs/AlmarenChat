import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import { ensureAgentMainConversation } from '@/lib/agents/ensure-main-conversation';

export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    const result = await ensureAgentMainConversation(userId, agentId);
    return NextResponse.json(result);
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error.message === 'Agent not found') return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    return NextResponse.json({ error: error.message || 'Failed to load main conversation' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    const result = await ensureAgentMainConversation(userId, agentId);
    return NextResponse.json(result);
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error.message === 'Agent not found') return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    return NextResponse.json({ error: error.message || 'Failed to create main conversation' }, { status: 500 });
  }
}
