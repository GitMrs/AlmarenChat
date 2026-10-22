import { smartFetch } from '../web/proxy.ts';
import { EVENT_MARKET_INSTRUMENT, EVENT_MARKET_WINDOWS, type EventMarketWindow, type EventMarketResult } from './event-market.ts';

interface ClosedCandle {
  at: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** 向前翻页，包含公布前一分钟作为基准；缺失、未收盘、异常数据都不能生成结果。 */
export async function fetchEventMarketWindow(scheduledAt: string, window: EventMarketWindow): Promise<EventMarketResult> {
  const start = Date.parse(scheduledAt);
  const count = EVENT_MARKET_WINDOWS[window];
  const end = start + count * 60_000;
  if (!Number.isFinite(start) || start % 60_000 !== 0) throw new Error('预定时间不是整分钟，无法精确统计');
  if (Date.now() < end) throw new Error('统计窗口尚未结束');
  const candles = new Map<number, ClosedCandle>();
  const sourceUrls: string[] = [];
  let cursor = end;
  // OKX 每页最多 300 根，24h 加基准共 1441 根，最多需要 5 页。
  for (let page = 0; page < 6 && cursor > start - 60_000; page++) {
    const url = new URL('https://www.okx.com/api/v5/market/history-candles');
    url.search = new URLSearchParams({ instId: EVENT_MARKET_INSTRUMENT, bar: '1m', limit: '300', after: String(cursor) }).toString();
    const response = await smartFetch(url.toString(), { timeoutMs: 8000, cache: 'no-store' });
    if (!response.ok) throw new Error(`OKX 行情请求失败（HTTP ${response.status}）`);
    const body = await response.json();
    if (body.code !== '0' || !Array.isArray(body.data) || !body.data.length) throw new Error('OKX 暂无所需历史K线');
    sourceUrls.push(url.toString());
    let oldest = cursor;
    for (const row of body.data) {
      if (!Array.isArray(row)) throw new Error('OKX K线格式异常');
      const [at, open, high, low, close] = row.slice(0, 5).map(Number);
      if (!Number.isFinite(at) || at % 60_000 !== 0) throw new Error('OKX K线时间异常');
      oldest = Math.min(oldest, at);
      if (at < start - 60_000 || at >= end) continue;
      if (row[8] !== '1' || at + 60_000 > Date.now()) throw new Error('所需K线尚未确认收盘');
      if (![open, high, low, close].every((n) => Number.isFinite(n) && n > 0) ||
          high < Math.max(open, close) || low > Math.min(open, close) || high < low) throw new Error('OKX K线价格异常');
      const previous = candles.get(at);
      if (previous && (previous.open !== open || previous.high !== high || previous.low !== low || previous.close !== close)) throw new Error('OKX 重复K线数据冲突');
      candles.set(at, { at, open, high, low, close });
    }
    if (oldest >= cursor) throw new Error('OKX 历史K线翻页未前进');
    cursor = oldest;
  }
  for (let at = start - 60_000; at < end; at += 60_000) {
    if (!candles.has(at)) throw new Error('历史K线缺失，等待补采');
  }
  const baselineClose = candles.get(start - 60_000)!.close;
  const prices = [...candles.values()].filter((c) => c.at >= start);
  const close = candles.get(end - 60_000)!.close;
  const high = Math.max(...prices.map((c) => c.high));
  const low = Math.min(...prices.map((c) => c.low));
  return {
    status: 'complete', baselineAt: new Date(start - 60_000).toISOString(), baselineClose,
    windowStart: new Date(start).toISOString(), windowEnd: new Date(end).toISOString(),
    close, high, low, returnPct: (close / baselineClose - 1) * 100,
    highPct: (high / baselineClose - 1) * 100, lowPct: (low / baselineClose - 1) * 100,
    candleCount: count, collectedAt: new Date().toISOString(), sourceUrls,
  };
}
