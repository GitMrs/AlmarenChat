import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import prisma from '@/app/api/_lib/db';
import { normalizeWeatherLocation, platformWeather } from '@/lib/weather.mjs';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const params = new URL(request.url).searchParams;
    const location = params.get('location')?.trim();
    const kind = params.get('kind') || 'now';
    const date = params.get('date') || undefined;
    if (!location || location.length > 100 || !['now', 'hourly', 'daily', 'locations'].includes(kind) || (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
      return NextResponse.json({ error: '请提供地点及有效的天气类型、日期' }, { status: 400 });
    }
    if (kind === 'locations') return NextResponse.json({ locations: await platformWeather.lookup(location) });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { defaultWeatherLocation: true } });
    const saved = normalizeWeatherLocation(user?.defaultWeatherLocation);
    return NextResponse.json(await platformWeather.query({ location, kind, date, ...(saved?.id === location ? { resolvedLocation: saved } : {}) }));
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: '天气查询失败，请稍后重试或确认地点' }, { status: 502 });
  }
}
