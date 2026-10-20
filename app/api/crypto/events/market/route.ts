import { NextResponse } from 'next/server';
import { collectNextEventMarketWindow } from '@/lib/crypto/event-market-collector.ts';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ success: false, error: '无效请求' }, { status: 400 }); }
  if (typeof body?.eventId !== 'string' || !body.eventId.trim()) {
    return NextResponse.json({ success: false, error: '缺少事件ID' }, { status: 400 });
  }
  try {
    const data = await collectNextEventMarketWindow(body.eventId);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.warn('[api/crypto/events/market] collection failed:', error);
    return NextResponse.json({ success: false, error: '行情补采失败，请稍后重试' }, { status: 500 });
  }
}
