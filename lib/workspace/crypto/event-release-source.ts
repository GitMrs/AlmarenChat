import { smartFetch } from '../../web/proxy.ts';
import { cleanReleaseValue, getMacroIndicator, parseReleaseNumber } from './event-release.ts';
import type { CryptoEvent } from './event-temporal.ts';

export interface ReleaseSourceRow {
  country: string;
  title: string;
  time: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
}
export interface ReleaseSourceDay { date: string; fetchedAt: string; url: string; rows: ReleaseSourceRow[] }

export function releaseLocalDate(timestamp: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Etc/GMT+5', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
}
function localTime(timestamp: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Etc/GMT+5', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp));
}

/** Nasdaq 的 ISO 日期参数在美东按 UTC 零点归日，查询目标日需传入下一 UTC 日。
 * gmt 字段在公开响应中实际为固定 UTC-5（EST，不随夏令时变化）。
 * 例如冬令时美国 PMI 09:45，夏令时 FOMC 13:00；不能按 UTC 或 EDT 解释。
 * 限于本适配器，不修改原日历的 UTC 公布时刻。
 */
export function releaseSourceUrl(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('无效公布日期');
  const next = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(next.getTime()) || next.toISOString().slice(0, 10) !== date) throw new Error('无效公布日期');
  next.setUTCDate(next.getUTCDate() + 1);
  return `https://api.nasdaq.com/api/calendar/economicevents?date=${next.toISOString().slice(0, 10)}`;
}

export function parseReleaseSourceDay(payload: any, date: string, fetchedAt: string): ReleaseSourceDay {
  if (payload?.status?.rCode !== 200 || !Array.isArray(payload?.data?.rows)) throw new Error('公布值来源返回无效日历');
  const rows: ReleaseSourceRow[] = payload.data.rows.map((row: any) => {
    if (!row || typeof row.country !== 'string' || typeof row.eventName !== 'string' || typeof row.gmt !== 'string') {
      throw new Error('公布值来源行结构异常');
    }
    return { country: row.country.trim(), title: row.eventName.trim(), time: row.gmt.trim(),
      actual: cleanReleaseValue(row.actual), forecast: cleanReleaseValue(row.consensus), previous: cleanReleaseValue(row.previous) };
  });
  return { date, fetchedAt, url: releaseSourceUrl(date), rows };
}

const cache = new Map<string, ReleaseSourceDay>();
export async function fetchReleaseSourceDay(date: string): Promise<ReleaseSourceDay> {
  const cached = cache.get(date);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 60_000) return cached;
  const url = releaseSourceUrl(date);
  const response = await smartFetch(url, { timeoutMs: 12_000, headers: {
    'User-Agent': 'Mozilla/5.0', Accept: 'application/json', 'Cache-Control': 'no-cache',
  } });
  if (!response.ok) throw new Error(`公布值来源 HTTP ${response.status}`);
  const day = parseReleaseSourceDay(await response.json(), date, new Date().toISOString());
  cache.set(date, day);
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
  return day;
}

/** 白名单系列 + 美国 + 发布日期 + 精确来源钟点；多行/改期不猜测、不模糊匹配。 */
export function matchReleaseSource(event: CryptoEvent, day: ReleaseSourceDay): { row?: ReleaseSourceRow; reason?: string } {
  const indicator = getMacroIndicator(event);
  if (!indicator || releaseLocalDate(event.timestamp) !== day.date) return { reason: '指标或公布日期不匹配' };
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
  const names = new Set(indicator.names.map(normalize));
  const rows = day.rows.filter((row) => row.country === 'United States' &&
    row.time === localTime(event.timestamp) && names.has(normalize(row.title)));
  if (rows.length !== 1) {
    // 聚合源可能删掉 (MoM)/(YoY)，即使只剩一行也不能据数值大小推测分项。
    const unqualified = new Set(indicator.names.map((name) => normalize(name.replace(/\s*\((?:MoM|YoY|QoQ)\)\s*/gi, ''))));
    const ambiguous = day.rows.some((row) => row.country === 'United States' && row.time === localTime(event.timestamp) && unqualified.has(normalize(row.title)));
    return { reason: rows.length ? '同一指标存在多条记录，等待核验' : ambiguous
      ? '补充源未明确区分月率、年率或季度口径，等待来源核验'
      : '来源未找到同日同时间同分项记录' };
  }
  const row = rows[0];
  if (row.actual && !parseReleaseNumber(row.actual) &&
      !(indicator.family === 'rate' && /^\d+(?:\.\d+)?%?\s*[-–]\s*\d+(?:\.\d+)?%$/.test(row.actual))) {
    return { reason: '来源实际值不是可识别的数值，等待核验' };
  }
  return { row };
}
