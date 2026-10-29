import { NextResponse } from 'next/server';
import {
  evaluateEventPhase,
  getEventLifecycleState,
  type EventImpactRecord,
  groupCryptoEvents,
  type CryptoEvent,
  type EvaluatedEvent,
} from '@/lib/workspace/crypto/event-temporal.ts';
import { persistEventImpact, readCryptoEventsFromDisk, syncMacroEvents } from '@/lib/workspace/crypto/event-sync.ts';
import { hasCompleteEventMarket } from '@/lib/workspace/crypto/event-market.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const symbol = searchParams.get('symbol');

    const now = new Date();
    let events = await readCryptoEventsFromDisk();

    if (category) {
      events = events.filter((e) => e.category === category);
    }

    if (symbol && symbol !== 'ALL') {
      const cleanSym = symbol.toUpperCase().replace(/-USDT-SWAP$/i, '').replace(/USDT$/i, '');
      events = events.filter(
        (e) => e.impactCoins.includes('ALL') || e.impactCoins.map((c) => c.toUpperCase()).includes(cleanSym)
      );
    }

    // 日历源可能把同一场 FOMC 拆成多行；接口只返回一个代表事件，原始阶段挂在 eventGroupMembers 中。
    events = groupCryptoEvents(events);

    const evaluated: EvaluatedEvent[] = events.map((e) => {
      const evalRes = evaluateEventPhase(e, now);
      return {
        event: e,
        phase: evalRes.phase,
        lifecycleState: getEventLifecycleState(e, now),
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
      (item) => item.event.volatilityTier >= 2 &&
        (item.phase === 'IN_THE_STORM' || (item.deltaMinutes >= -15 && item.deltaMinutes <= 120))
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
    }, { headers: { 'Cache-Control': 'no-store' } });
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

/** 保存事件复盘。带核验结论时必须已经完成 24 小时行情窗口，并提供可访问来源。 */
export async function PUT(request: Request) {
  let body: any;
  try { body = await request.json(); }
  catch { return NextResponse.json({ success: false, error: '无效请求' }, { status: 400 }); }
  const eventId = typeof body?.eventId === 'string' ? body.eventId.trim() : '';
  const impact = body?.impact as EventImpactRecord | undefined;
  if (!eventId || !impact || typeof impact !== 'object' || !impact.marketReaction || typeof impact.marketReaction !== 'object') {
    return NextResponse.json({ success: false, error: '缺少有效的 eventId 或复盘内容' }, { status: 400 });
  }
  try {
    const events = await readCryptoEventsFromDisk();
    const event = events.find((item) => item.id === eventId);
    if (!event) return NextResponse.json({ success: false, error: '事件不存在' }, { status: 404 });
    if (impact.verification) {
      const verification = impact.verification;
      const verifiedAt = Date.parse(verification.verifiedAt);
      const eventAt = Date.parse(event.timestamp);
      const sourcesValid = Array.isArray(verification.sourceUrls) && verification.sourceUrls.length > 0 &&
        verification.sourceUrls.every((url) => { try { return ['https:', 'http:'].includes(new URL(url).protocol); } catch { return false; } });
      if (!sourcesValid || !Number.isFinite(verifiedAt) || verifiedAt < eventAt + 24 * 60 * 60_000 || verifiedAt > Date.now()) {
        return NextResponse.json({ success: false, error: '核验复盘必须在事件 24 小时后提交，并包含有效来源 URL' }, { status: 422 });
      }
      if (!hasCompleteEventMarket(event, new Date())) {
        return NextResponse.json({ success: false, error: '24 小时行情窗口尚未完成，暂不能提交最终复盘' }, { status: 422 });
      }
    }
    const saved = await persistEventImpact(eventId, impact);
    return saved
      ? NextResponse.json({ success: true, data: { eventId, lifecycleState: getEventLifecycleState({ ...event, impact }, new Date()) } })
      : NextResponse.json({ success: false, error: '复盘保存失败' }, { status: 500 });
  } catch (error: any) {
    console.error('[api/crypto/events] PUT review failed:', error);
    return NextResponse.json({ success: false, error: error?.message || '复盘保存失败' }, { status: 500 });
  }
}
