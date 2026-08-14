import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import { getAgentRunForUser } from '@/app/api/_lib/agent-runs';

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { runId } = await params;
    const run = await getAgentRunForUser(runId, userId);
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    return NextResponse.json({ run });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
