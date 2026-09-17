import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import { checkAllAgentsStatus } from '@/lib/coding-agents/detector';

export async function GET(request: Request) {
  try {
    requireAuth(request);
    const agents = await checkAllAgentsStatus();
    return NextResponse.json({ agents });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const status = errorMsg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: errorMsg }, { status });
  }
}
