import { readCryptoEventsFromDisk, persistEventRelease } from './event-sync.ts';
import { getMacroIndicator, getPublishedRelease, type MacroRelease } from './event-release.ts';
import { fetchReleaseSourceDay, matchReleaseSource, releaseLocalDate } from './event-release-source.ts';
import type { CryptoEvent } from './event-temporal.ts';

const globalForRelease = globalThis as unknown as { __eventReleaseCollector?: { collecting: boolean } };
const state = globalForRelease.__eventReleaseCollector ??= { collecting: false };
const HOUR = 3_600_000;

export function releaseCollectionDue(event: CryptoEvent, now = new Date(), force = false): boolean {
  const at = Date.parse(event.timestamp);
  const age = now.getTime() - at;
  if (event.simulated || !getMacroIndicator(event) || !Number.isFinite(at) || age < 0) return false;
  const record = event.release && Date.parse(event.release.scheduledAt) === at ? event.release : undefined;
  if (force) return !record || now.getTime() - Date.parse(record.lastAttemptAt || record.checkedAt) >= 30_000;
  if (age > 72 * HOUR) return record?.status !== 'unavailable' && !getPublishedRelease(event, now);
  return !record || !record.retryAt || Date.parse(record.retryAt) <= now.getTime();
}

/** 一次共用一个美东日的数据，原子合并每条结果；没有到期事件不联网。 */
export async function collectNextEventRelease(eventId?: string) {
  if (state.collecting) return { status: 'busy' as const };
  state.collecting = true;
  try {
    const now = new Date();
    const events = await readCryptoEventsFromDisk();
    const eligible = events.filter((event) => (!eventId || event.id === eventId) && releaseCollectionDue(event, now, !!eventId));
    // 先取得从未检查的结果，之后按重试到期时间轮转，避免某一日持续失败饿死其他日期。
    eligible.sort((a, b) => Number(now.getTime() - Date.parse(a.timestamp) > 72 * HOUR) - Number(now.getTime() - Date.parse(b.timestamp) > 72 * HOUR) ||
      Date.parse(a.release?.retryAt || a.timestamp) - Date.parse(b.release?.retryAt || b.timestamp));
    const first = eligible[0];
    if (!first) return { status: 'idle' as const };
    const date = releaseLocalDate(first.timestamp);
    const batch = eligible.filter((event) => releaseLocalDate(event.timestamp) === date);
    const active = batch.filter((event) => now.getTime() - Date.parse(event.timestamp) <= 72 * HOUR || !!eventId);
    let day: Awaited<ReturnType<typeof fetchReleaseSourceDay>> | undefined;
    let sourceError: string | undefined;
    if (active.length) {
      try { day = await fetchReleaseSourceDay(date); }
      catch (error) { sourceError = error instanceof Error && /^公布值来源 (?:HTTP \d{3}|返回无效日历|行结构异常)$/.test(error.message) ? error.message : '公布值来源暂时不可用'; }
    }
    let published = 0;
    let saved = 0;
    for (const event of batch) {
      const checkedAt = day?.fetchedAt || new Date().toISOString();
      const age = Date.parse(checkedAt) - Date.parse(event.timestamp);
      const prior = event.release && Date.parse(event.release.scheduledAt) === Date.parse(event.timestamp) ? event.release : undefined;
      const existing = getPublishedRelease(event, new Date(checkedAt));
      const base: MacroRelease = {
        status: 'pending', scheduledAt: event.timestamp, checkedAt, lastAttemptAt: new Date().toISOString(), attempts: (prior?.attempts || 0) + 1,
        forecast: existing ? existing.forecast : prior ? prior.forecast : event.forecast,
        previous: existing ? existing.previous : prior ? prior.previous : event.previous,
        forecastRecordedAt: prior?.forecastRecordedAt || event.calendarRecordedAt || event.source?.fetchedAt,
      };
      const retryMs = age < HOUR ? 60_000 : age < 6 * HOUR ? 5 * 60_000 : HOUR;
      const match = day ? matchReleaseSource(event, day) : undefined;
      let record: MacroRelease;
      if (age > 72 * HOUR && !eventId) record = { ...base, status: 'unavailable', reason: '超过自动补采窗口（72小时），可手动补采或核验来源' };
      else if (sourceError) record = existing
        ? { ...existing, lastAttemptAt: base.lastAttemptAt, attempts: base.attempts, retryAt: new Date(Date.now() + retryMs).toISOString(), error: sourceError }
        : { ...base, status: 'retry', error: sourceError, retryAt: new Date(Date.now() + retryMs).toISOString() };
      else if (match?.row?.actual) {
        const revisions = [...(existing?.revisions || [])];
        if (existing?.actual && existing.actual !== match.row.actual) revisions.push({ actual: existing.actual, collectedAt: existing.checkedAt });
        record = { ...base, status: 'published', actual: match.row.actual,
          sourceForecast: match.row.forecast, sourcePrevious: match.row.previous,
          source: { provider: 'nasdaq', url: day!.url, title: match.row.title, fetchedAt: checkedAt },
          revisions: revisions.slice(-8), retryAt: new Date(Date.now() + HOUR).toISOString() };
      } else if (existing) record = { ...existing, lastAttemptAt: base.lastAttemptAt, attempts: base.attempts, retryAt: new Date(Date.now() + retryMs).toISOString(), error: '补充源本轮缺少已公布结果，保留上次有效值' };
      else record = { ...base, reason: match?.reason || '来源尚未提供公布值', retryAt: new Date(Date.now() + retryMs).toISOString() };
      if (await persistEventRelease(event.id, event.timestamp, record)) {
        saved++;
        if (record.status === 'published') published++;
      }
    }
    return { status: sourceError ? 'retry' as const : published ? 'published' as const : 'pending' as const, saved, published };
  } finally { state.collecting = false; }
}
