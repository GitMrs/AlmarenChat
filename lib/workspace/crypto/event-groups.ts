import type { CryptoEvent } from './event-temporal.ts';
import type { EventMarketObservation } from './event-market.ts';

/** 将日历源拆成多行的同一场 FOMC 事件归入同一组。 */
export function getCryptoEventGroupKey(event: Pick<CryptoEvent, 'id' | 'title' | 'timestamp' | 'eventGroupKey'>): string {
  if (event.eventGroupKey?.trim()) return event.eventGroupKey;
  const text = `${event.id} ${event.title}`;
  const isFomcMemberSpeech = /member[- ]|member.*speaks|成员.*讲话/i.test(text);
  const isFomcDecision = !isFomcMemberSpeech &&
    /federal funds rate|fomc.*(?:statement|press conference|rate|decision|projections)|美联储.*(?:利率决议|政策声明|新闻发布会|经济预测)/i.test(text);
  if (isFomcDecision) {
    return `fomc:${String(event.timestamp).slice(0, 10)}`;
  }
  return `event:${event.id}`;
}

function phaseGroupKey(event: CryptoEvent): string {
  return `${getCryptoEventGroupKey(event)}:${event.timestamp}`;
}

function mergeMarketObservation(events: CryptoEvent[], timestamp: string): EventMarketObservation | undefined {
  const observations = events
    .filter((event) => event.timestamp === timestamp && event.marketObservation &&
      Date.parse(event.marketObservation.scheduledAt) === Date.parse(timestamp))
    .map((event) => event.marketObservation!);
  if (!observations.length) return undefined;
  const stages: EventMarketObservation['stages'] = {};
  for (const window of ['5m', '1h', '24h'] as const) {
    const candidates = observations.map((observation) => observation.stages[window]).filter(Boolean);
    candidates.sort((a, b) => {
      const completeDelta = Number(b?.status === 'complete') - Number(a?.status === 'complete');
      if (completeDelta) return completeDelta;
      return Date.parse((b as any)?.collectedAt || (b as any)?.attemptedAt || '') -
        Date.parse((a as any)?.collectedAt || (a as any)?.attemptedAt || '');
    });
    if (candidates[0]) stages[window] = candidates[0];
  }
  return { ...observations[0], scheduledAt: timestamp, stages };
}

function groupEvents(events: CryptoEvent[], keyOf: (event: CryptoEvent) => string, includeMembers: boolean): CryptoEvent[] {
  const groups = new Map<string, CryptoEvent[]>();
  let uniqueIndex = 0;
  for (const event of events) {
    const rawKey = keyOf(event);
    // 普通事件没有分组语义；即使测试或手工数据 id 相同，也不能互相覆盖。
    const key = rawKey.startsWith('event:') ? `${rawKey}:${uniqueIndex++}` : rawKey;
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }
  const result: CryptoEvent[] = [];
  for (const members of groups.values()) {
    if (members.length === 1) {
      const event = members[0];
      const groupKey = getCryptoEventGroupKey(event);
      result.push(groupKey === `event:${event.id}` ? event : { ...event, eventGroupKey: groupKey });
      continue;
    }
    const sorted = [...members].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id));
    const representative = sorted[0];
    const groupKey = getCryptoEventGroupKey(representative);
    const impactSource = sorted.find((event) => event.impact);
    const forecastSource = sorted.find((event) => event.forecast || event.previous);
    const merged: CryptoEvent = {
      ...representative,
      ...(impactSource && !representative.impact ? { impact: impactSource.impact } : {}),
      ...(forecastSource && !representative.forecast && !representative.previous
        ? { forecast: forecastSource.forecast, previous: forecastSource.previous } : {}),
      eventGroupKey: groupKey,
    };
    const observation = mergeMarketObservation(members, representative.timestamp);
    if (observation) merged.marketObservation = observation;
    if (includeMembers) {
      merged.eventGroupMembers = sorted.slice(1).map((event) => {
        const { eventGroupMembers: _nested, ...member } = event;
        return member;
      });
    }
    result.push(merged);
  }
  return result.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

/** 前端、上下文和哨兵使用：一场事件只保留一个代表，阶段放入 eventGroupMembers。 */
export function groupCryptoEvents(events: CryptoEvent[]): CryptoEvent[] {
  return groupEvents(events, getCryptoEventGroupKey, true);
}

/** 行情采集使用：同一事件组的不同发布时间仍是不同阶段，各阶段分别采集。 */
export function dedupeCryptoEventPhases(events: CryptoEvent[]): CryptoEvent[] {
  return groupEvents(events, phaseGroupKey, false);
}
