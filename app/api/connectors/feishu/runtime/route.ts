import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import { checkFeishuRuntime } from '@/lib/connectors/feishu-runtime.mjs';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    requireAuth(request);
    return NextResponse.json(await checkFeishuRuntime(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : 500 });
  }
}
