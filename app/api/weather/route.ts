import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import { platformWeather } from '@/lib/weather.mjs';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    requireAuth(request);
    const params = new URL(request.url).searchParams;
    const location = params.get('location')?.trim();
    const kind = params.get('kind') || 'now';
    const date = params.get('date') || undefined;
    if (!location || location.length > 100 || !['now', 'hourly', 'daily', 'locations'].includes(kind) || (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
      return NextResponse.json({ error: '请提供地点及有效的天气类型、日期' }, { status: 400 });
    }
    if (kind === 'locations') return NextResponse.json({ locations: await platformWeather.lookup(location) });
    return NextResponse.json(await platformWeather.query({ location, kind, date }));
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: '天气查询失败，请稍后重试或确认地点' }, { status: 502 });
  }
}
