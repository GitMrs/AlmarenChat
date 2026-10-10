import { smartFetch } from '../network/proxy.ts';
import {
  extractCryptoSymbolFromText,
  normalizeSymbol,
  analyzeCryptoTrap,
  formatCryptoContextForPrompt,
  COMMON_SYMBOLS,
} from './okx-analysis.mjs';

export {
  extractCryptoSymbolFromText,
  normalizeSymbol,
  analyzeCryptoTrap,
  formatCryptoContextForPrompt,
  COMMON_SYMBOLS,
};

export interface CryptoCandle {
  time: string;
  startTimeMs: number;
  isClosed: boolean;
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
}

export interface CryptoMarketSnapshot {
  symbol: string;
  instId: string;
  price: number;
  open24h: number;
  high24h: number;
  low24h: number;
  vol24hQuote: number;
  fundingRate: number;
  nextFundingRate?: number;
  oiUsd: number;
  oiDelta1hPercent: number;
  longShortRatio?: number;
  candles15m: CryptoCandle[];
  candles1h: CryptoCandle[];
  candles4h: CryptoCandle[];
  priceDelta15mPercent: number;
  priceDelta1hPercent: number;
  priceDelta4hPercent: number;
  realtimeFetchedAt: string;
  derivativesFetchedAt: string;
  structureFetchedAt: string;
  dataQuality: CryptoDataQuality;
}

export interface CryptoDataQuality {
  ticker: boolean;
  openInterest: boolean;
  fundingRate: boolean;
  oiDelta1h: boolean;
  longShortRatio: boolean;
  candles15m: boolean;
  candles1h: boolean;
  candles4h: boolean;
}

export interface TrapAnalysisResult {
  trapType: 'BULL_TRAP_DIVERGENCE' | 'BEAR_TRAP_DIVERGENCE' | 'GENUINE_BREAKOUT' | 'HEALTHY_CONSOLIDATION' | 'DELEVERAGING_CASCADE';
  trapTitle: string;
  divergenceDescription: string;
  fundingRateAssessment: string;
  confidenceScore: number;
  locationDesc: string;
  checklist: string[];
  sentimentRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  suggestedAction: string;
}

/**
 * 行情按用途分层缓存：实时层短缓存，结构层跟随 K 线边界，衍生指标使用分钟级缓存。
 * 同一轮并发请求继续合并，避免多个 Agent 重复访问 OKX。
 */
const REALTIME_CACHE_TTL_MS = 2500;
const DERIVATIVES_CACHE_TTL_MS = 60_000;
const CANDLE_BOUNDARY_GRACE_MS = 5_000;
type CacheEntry<T> = { fetchedAt: number; value: T };
type CandleCacheEntry = CacheEntry<CryptoCandle[]> & { periodStartMs: number; periodMs: number };
const realtimeCache = new Map<string, CacheEntry<{
  price: number;
  open24h: number;
  high24h: number;
  low24h: number;
  vol24hQuote: number;
  oiUsd: number;
  dataQuality: Pick<CryptoDataQuality, 'ticker' | 'openInterest'>;
}>>();
const derivativesCache = new Map<string, CacheEntry<{
  fundingRate: number;
  nextFundingRate?: number;
  oiDelta1hPercent: number;
  longShortRatio?: number;
  dataQuality: Pick<CryptoDataQuality, 'fundingRate' | 'oiDelta1h' | 'longShortRatio'>;
}>>();
const candleCache = new Map<string, CandleCacheEntry>();
const inFlightRequests = new Map<string, Promise<CryptoMarketSnapshot | null>>();

export function clearCryptoCache(): void {
  realtimeCache.clear();
  derivativesCache.clear();
  candleCache.clear();
  inFlightRequests.clear();
}

/**
 * 从 OKX 获取指定币种的完整衍生品与多周期行情
 */
export async function getCryptoMarketData(rawSymbol: string): Promise<CryptoMarketSnapshot | null> {
  const { ccy, instId } = normalizeSymbol(rawSymbol);

  // 同一交易对的整轮组装请求合并，内部各数据层按自己的过期时间决定是否访问 OKX。
  const existingPromise = inFlightRequests.get(instId);
  if (existingPromise) {
    return existingPromise;
  }

  const fetchPromise = (async () => {
    try {
      return await fetchMarketDataDirect(ccy, instId, rawSymbol);
    } finally {
      inFlightRequests.delete(instId);
    }
  })();

  inFlightRequests.set(instId, fetchPromise);
  return fetchPromise;
}

async function fetchMarketDataDirect(ccy: string, instId: string, rawSymbol: string): Promise<CryptoMarketSnapshot | null> {

  try {
    const now = Date.now();
    const realtime = await getRealtimeData(instId, now);
    if (!realtime || realtime.value.price <= 0) return null;
    const [derivatives, candles15m, candles1h, candles4h] = await Promise.all([
      getDerivativesData(ccy, instId, now),
      getCandles(instId, '15m', 15 * 60_000, now),
      getCandles(instId, '1H', 60 * 60_000, now),
      getCandles(instId, '4H', 4 * 60 * 60_000, now),
    ]);
    const delta = (candles: CryptoCandle[]) => candles[0]?.open > 0
      ? ((realtime.value.price - candles[0].open) / candles[0].open) * 100
      : 0;
    const structureFetchedAt = ['15m', '1H', '4H']
      .map((bar) => candleCache.get(`${instId}:${bar}`)?.fetchedAt || 0)
      .filter(Boolean)
      .map((value) => new Date(value).toISOString())
      .sort()[0] || new Date(now).toISOString();

    return {
      symbol: ccy,
      instId,
      ...realtime.value,
      ...derivatives.value,
      candles15m: candles15m.slice(0, 5),
      candles1h: candles1h.slice(0, 6),
      candles4h: candles4h.slice(0, 6),
      priceDelta15mPercent: delta(candles15m),
      priceDelta1hPercent: delta(candles1h),
      priceDelta4hPercent: delta(candles4h),
      realtimeFetchedAt: new Date(realtime.fetchedAt).toISOString(),
      derivativesFetchedAt: new Date(derivatives.fetchedAt).toISOString(),
      structureFetchedAt,
      dataQuality: {
        ...realtime.value.dataQuality,
        ...derivatives.value.dataQuality,
        candles15m: candles15m.length > 0,
        candles1h: candles1h.length > 0,
        candles4h: candles4h.length > 0,
      },
    };
  } catch (err: any) {
    console.error(`[getCryptoMarketData] Failed to fetch data for ${rawSymbol}:`, err?.message || err);
    return null;
  }
}

async function getRealtimeData(instId: string, now: number) {
  const cached = realtimeCache.get(instId);
  if (cached && now - cached.fetchedAt < REALTIME_CACHE_TTL_MS) return cached;
  const [tickerRes, oiRes] = await Promise.allSettled([
    smartFetch(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`, { timeoutMs: 5000 }),
    smartFetch(`https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${instId}`, { timeoutMs: 5000 }),
  ]);
  let price = 0;
  let tickerAvailable = false;
  let open24h = 0;
  let high24h = 0;
  let low24h = 0;
  let vol24hQuote = 0;
  if (tickerRes.status === 'fulfilled' && tickerRes.value.ok) {
    const t = (await tickerRes.value.json().catch(() => ({}))).data?.[0];
    if (t) {
      price = parseFloat(t.last || '0');
      tickerAvailable = price > 0;
      open24h = parseFloat(t.open24h || '0');
      high24h = parseFloat(t.high24h || '0');
      low24h = parseFloat(t.low24h || '0');
      vol24hQuote = parseFloat(t.volCcy24h || '0');
    }
  }
  if (price <= 0) return null;
  let oiUsd = 0;
  let openInterestAvailable = false;
  if (oiRes.status === 'fulfilled' && oiRes.value.ok) {
    const o = (await oiRes.value.json().catch(() => ({}))).data?.[0];
    if (o) {
      const directUsd = parseFloat(o.oiUsd || '0');
      const oiCoins = parseFloat(o.oiCcy || '0');
      oiUsd = directUsd > 0 ? directUsd : oiCoins > 0 ? oiCoins * price : 0;
      openInterestAvailable = directUsd > 0 || oiCoins > 0;
    }
  }
  const entry = {
    fetchedAt: Date.now(),
    value: {
      price, open24h, high24h, low24h, vol24hQuote, oiUsd,
      dataQuality: {
        ticker: tickerAvailable,
        openInterest: openInterestAvailable,
      },
    },
  };
  realtimeCache.set(instId, entry);
  return entry;
}

async function getDerivativesData(ccy: string, instId: string, now: number) {
  const cached = derivativesCache.get(instId);
  if (cached && now - cached.fetchedAt < DERIVATIVES_CACHE_TTL_MS) return cached;
  const [frRes, rubikOiRes, lsRes] = await Promise.allSettled([
    smartFetch(`https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`, { timeoutMs: 5000 }),
    smartFetch(`https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-volume?ccy=${ccy}&period=1H`, { timeoutMs: 5000 }),
    smartFetch(`https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${ccy}&period=1H`, { timeoutMs: 5000 }),
  ]);
  let fundingRate = 0;
  let fundingRateAvailable = false;
  let nextFundingRate: number | undefined;
  if (frRes.status === 'fulfilled' && frRes.value.ok) {
    const f = (await frRes.value.json().catch(() => ({}))).data?.[0];
    if (f) {
      fundingRate = parseFloat(f.fundingRate || '0');
      fundingRateAvailable = Number.isFinite(fundingRate);
      if (f.nextFundingRate) nextFundingRate = parseFloat(f.nextFundingRate);
    }
  }
  let oiDelta1hPercent = 0;
  let oiDeltaAvailable = false;
  if (rubikOiRes.status === 'fulfilled' && rubikOiRes.value.ok) {
    const list = (await rubikOiRes.value.json().catch(() => ({}))).data;
    if (Array.isArray(list) && list.length >= 2) {
      const current = parseFloat(list[0][1] || '0');
      const previous = parseFloat(list[1][1] || '0');
      if (previous > 0) {
        oiDelta1hPercent = ((current - previous) / previous) * 100;
        oiDeltaAvailable = true;
      }
    }
  }
  let longShortRatio: number | undefined;
  let longShortRatioAvailable = false;
  if (lsRes.status === 'fulfilled' && lsRes.value.ok) {
    const list = (await lsRes.value.json().catch(() => ({}))).data;
    if (Array.isArray(list) && list.length > 0) {
      longShortRatio = parseFloat(list[0][1] || '');
      longShortRatioAvailable = Number.isFinite(longShortRatio);
    }
  }
  const entry = {
    fetchedAt: Date.now(),
    value: {
      fundingRate, nextFundingRate, oiDelta1hPercent, longShortRatio,
      dataQuality: {
        fundingRate: fundingRateAvailable,
        oiDelta1h: oiDeltaAvailable,
        longShortRatio: longShortRatioAvailable,
      },
    },
  };
  derivativesCache.set(instId, entry);
  return entry;
}

async function getCandles(instId: string, bar: string, periodMs: number, now: number): Promise<CryptoCandle[]> {
  const periodStartMs = Math.floor(now / periodMs) * periodMs;
  const key = `${instId}:${bar}`;
  const cached = candleCache.get(key);
  if (cached && cached.periodStartMs === periodStartMs && now < periodStartMs + CANDLE_BOUNDARY_GRACE_MS + periodMs) {
    return cached.value;
  }
  const response = await smartFetch(`https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=10`, { timeoutMs: 5000 }).catch(() => null);
  if (!response?.ok) return cached?.value || [];
  const json = await response.json().catch(() => ({}));
  const rawList = Array.isArray(json.data) ? json.data : [];
  const candles = rawList.map((item: any[]) => {
    const startTimeMs = parseInt(item[0], 10);
    return {
      time: new Date(startTimeMs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      startTimeMs,
      isClosed: item[8] === '1',
      open: parseFloat(item[1]),
      high: parseFloat(item[2]),
      low: parseFloat(item[3]),
      close: parseFloat(item[4]),
      vol: parseFloat(item[5] || '0'),
    };
  });
  candleCache.set(key, { fetchedAt: Date.now(), value: candles, periodStartMs, periodMs });
  return candles;
}
