import { NextResponse } from 'next/server';
import {
  loadGlobalCryptoEvents,
  evaluateEventPhase,
  type CryptoEvent,
  type EvaluatedEvent,
} from '@/lib/crypto/event-temporal.ts';
import { syncMacroEvents } from '@/lib/crypto/event-sync.ts';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const symbol = searchParams.get('symbol');

    const now = new Date();
    let events = loadGlobalCryptoEvents();

    if (category) {
      events = events.filter((e) => e.category === category);
    }

    if (symbol && symbol !== 'ALL') {
      const cleanSym = symbol.toUpperCase().replace(/-USDT-SWAP$/i, '').replace(/USDT$/i, '');
      events = events.filter(
        (e) => e.impactCoins.includes('ALL') || e.impactCoins.map((c) => c.toUpperCase()).includes(cleanSym)
      );
    }

    const evaluated: EvaluatedEvent[] = events.map((e) => {
      const evalRes = evaluateEventPhase(e, now);
      return {
        event: e,
        phase: evalRes.phase,
        deltaMinutes: evalRes.deltaMinutes,
        countdownText: evalRes.countdownText,
        formattedLocalTime: evalRes.formattedLocalTime,
      };
    });

    // 1. 临近/进行中事件 (距离现在 >= -15分钟，按时间升序)
    const upcoming = evaluated
      .filter((item) => item.deltaMinutes >= -15)
      .sort((a, b) => a.deltaMinutes - b.deltaMinutes);

    // 2. 核心活跃警戒窗口 (暴风雨中 或 距离发生 <= 2 小时)
    const activeAlerts = evaluated.filter(
      (item) => item.phase === 'IN_THE_STORM' || (item.deltaMinutes >= -15 && item.deltaMinutes <= 120)
    );

    // 3. 历史大事件回顾 (已沉淀 impact 实战复盘记录，或已过期事件，按时间倒序)
    const historical = evaluated
      .filter((item) => Boolean(item.event.impact) || item.deltaMinutes < -15)
      .sort((a, b) => b.deltaMinutes - a.deltaMinutes);

    return NextResponse.json({
      success: true,
      data: {
        upcoming,
        historical,
        activeAlerts,
        total: events.length,
      },
    });
  } catch (error: any) {
    console.error('[api/crypto/events] GET failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || '获取加密大事件失败',
      },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const result = await syncMacroEvents();
    return NextResponse.json({
      success: true,
      message: `同步成功！拉取 ${result.fetchedRawCount} 条，过滤出 ${result.filteredCount} 项重点宏观事件，库内累计 ${result.total} 项。`,
      data: result,
    });
  } catch (error: any) {
    console.error('[api/crypto/events] POST sync failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || '同步实时财经日历失败',
      },
      { status: 500 }
    );
  }
}
