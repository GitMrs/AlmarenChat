import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import { getAgentRunForUser } from '@/app/api/_lib/agent-runs';

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { runId } = await params;
    const afterSequence = Number(new URL(request.url).searchParams.get('afterSequence') || 0);
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      return NextResponse.json({ error: 'afterSequence must be a non-negative integer' }, { status: 400 });
    }
    const run = await getAgentRunForUser(runId, userId, afterSequence);
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    return NextResponse.json({ run });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
