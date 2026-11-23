import { NextResponse } from 'next/server';
import { collectNextEventRelease } from '@/lib/workspace/crypto/event-release-collector.ts';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ success: false, error: '无效请求' }, { status: 400 }); }
  if (typeof body?.eventId !== 'string' || !body.eventId.trim()) {
    return NextResponse.json({ success: false, error: '缺少事件ID' }, { status: 400 });
  }
  try {
    const data = await collectNextEventRelease(body.eventId.trim());
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.warn('[api/crypto/events/release] collection failed:', error);
    return NextResponse.json({ success: false, error: '公布值补采失败，请稍后重试' }, { status: 500 });
  }
}
