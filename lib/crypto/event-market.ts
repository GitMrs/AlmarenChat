import type { CryptoEvent } from './event-temporal.ts';

export const EVENT_MARKET_WINDOWS = { '5m': 5, '1h': 60, '24h': 1440 } as const;
export type EventMarketWindow = keyof typeof EVENT_MARKET_WINDOWS;
export const EVENT_MARKET_INSTRUMENT = 'BTC-USDT-SWAP';

export interface EventMarketResult {
  status: 'complete';
  baselineAt: string;
  baselineClose: number;
  windowStart: string;
  windowEnd: string;
  close: number;
  high: number;
  low: number;
  returnPct: number;
  highPct: number;
  lowPct: number;
  candleCount: number;
  collectedAt: string;
  sourceUrls: string[];
}

export interface EventMarketRetry {
  status: 'retry';
  attemptedAt: string;
  retryAt: string;
  error: string;
}

export interface EventMarketObservation {
  provider: 'okx';
  instrument: typeof EVENT_MARKET_INSTRUMENT;
  scheduledAt: string;
  stages: Partial<Record<EventMarketWindow, EventMarketResult | EventMarketRetry>>;
}

/** 只统计影响 BTC 的真实宏观事件，分钟 K 线不能精确还原非整分钟发布。 */
export function canTrackEventMarket(event: CryptoEvent): boolean {
  const at = Date.parse(event.timestamp);
  return !event.simulated && event.category === 'macro' && Number.isFinite(at) && at % 60_000 === 0 &&
    event.impactCoins.some((coin) => ['ALL', 'BTC'].includes(coin.toUpperCase()));
}

export function getEventMarketResult(event: CryptoEvent, window: EventMarketWindow, now = new Date()): EventMarketResult | undefined {
  const observation = event.marketObservation;
  const result = observation?.stages?.[window];
  const at = Date.parse(event.timestamp);
  const end = at + EVENT_MARKET_WINDOWS[window] * 60_000;
  if (!canTrackEventMarket(event) || observation?.provider !== 'okx' ||
      observation.instrument !== EVENT_MARKET_INSTRUMENT || Date.parse(observation.scheduledAt) !== at ||
      result?.status !== 'complete' || Date.parse(result.baselineAt) !== at - 60_000 ||
      Date.parse(result.windowStart) !== at || Date.parse(result.windowEnd) !== end ||
      Date.parse(result.collectedAt) < end || Date.parse(result.collectedAt) > now.getTime() ||
      !Number.isFinite(Date.parse(result.collectedAt)) || result.candleCount !== EVENT_MARKET_WINDOWS[window]) return undefined;
  if (![result.baselineClose, result.close, result.high, result.low].every((n) => Number.isFinite(n) && n > 0) ||
      result.high < result.low || result.high < result.close || result.low > result.close ||
      ![result.returnPct, result.highPct, result.lowPct].every(Number.isFinite)) return undefined;
  const pct = (price: number) => (price / result.baselineClose - 1) * 100;
  if (Math.abs(result.returnPct - pct(result.close)) > 1e-8 ||
      Math.abs(result.highPct - pct(result.high)) > 1e-8 || Math.abs(result.lowPct - pct(result.low)) > 1e-8 ||
      !Array.isArray(result.sourceUrls) || !result.sourceUrls.length || !result.sourceUrls.every((url) => {
        try { const source = new URL(url); return source.protocol === 'https:' && source.hostname === 'www.okx.com' && source.pathname === '/api/v5/market/history-candles'; }
        catch { return false; }
      })) return undefined;
  return result;
}

export function hasCompleteEventMarket(event: CryptoEvent, now = new Date()): boolean {
  const results = (Object.keys(EVENT_MARKET_WINDOWS) as EventMarketWindow[]).map((window) => getEventMarketResult(event, window, now));
  return results.every((result) => result && result.baselineClose === results[0]?.baselineClose);
}

export function formatMarketPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}
