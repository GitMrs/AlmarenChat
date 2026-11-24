import { smartFetch } from '../../web/proxy.ts';
import { analyzeStructure } from './timeframe-analysis.mjs';
import {
  extractCryptoSymbolFromText,
  normalizeSymbol,
  analyzeCryptoTrap,
  estimateLiquidationMagnet,
  formatCryptoContextForPrompt,
  COMMON_SYMBOLS,
} from './okx-analysis.mjs';

export {
  extractCryptoSymbolFromText,
  normalizeSymbol,
  analyzeCryptoTrap,
  estimateLiquidationMagnet,
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

export interface CryptoOIWindow {
  from: string;
  to: string;
  period: '1H';
  scope: 'OKX_INSTRUMENT_CONTRACTS';
  instId: string;
  metric: 'CONTRACTS';
  ccy: string;
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
  oiDelta1hWindow?: CryptoOIWindow | null;
  longShortRatio?: number;
  candles15m: CryptoCandle[];
  candles1h: CryptoCandle[];
  candles4h: CryptoCandle[];
  candles1d: CryptoCandle[];
  dailyStructure: ReturnType<typeof analyzeStructure> | null;
  microstructure: CryptoMicrostructure;
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
  orderBook: boolean;
  trades: boolean;
  liquidations: boolean;
}

export interface CryptoMicrostructure {
  bidDepthUsd: number;
  askDepthUsd: number;
  depthImbalance: number;
  aggressiveBuyUsd: number;
  aggressiveSellUsd: number;
  liquidationLongUsd: number;
  liquidationShortUsd: number;
  liquidationCount: number;
  liquidationSampleFrom?: string | null;
  liquidationSampleTo?: string | null;
  fetchedAt: string;
  dataQuality: Pick<CryptoDataQuality, 'orderBook' | 'trades' | 'liquidations'>;
}

export interface LiquidationTier {
  leverage: number;
  price: number;
  distancePercent: number;
  estVolumeUsd: number;
}

export interface LiquidationClusterGroup {
  tier50x: LiquidationTier;
  tier20x: LiquidationTier;
  tier10x: LiquidationTier;
  denseMin: number;
  denseMax: number;
  totalAtRiskUsd: number;
}

export interface FundingRateShift {
  current: number;
  next?: number;
  diff: number;
  trend: 'INCREASING' | 'DECREASING' | 'STABLE';
  warning: string;
}

export interface CrowdSentiment {
  longShortRatio: number;
  longSharePercent: number;
  shortSharePercent: number;
  crowdState: 'HEAVILY_LONG' | 'MODERATELY_LONG' | 'BALANCED' | 'MODERATELY_SHORT' | 'HEAVILY_SHORT';
  contrarianSignal: string;
}

export interface LiquidationMagnetResult {
  methodology: 'HEURISTIC_ACCOUNT_RATIO';
  magnetBias: 'DOWN_SWEEP' | 'UP_SWEEP' | 'BALANCED';
  biasTitle: string;
  intensityScore: number;
  targetPrice: number;
  targetDescription: string;
  longClusters: LiquidationClusterGroup;
  shortClusters: LiquidationClusterGroup;
  fundingRateShift: FundingRateShift | null;
  microstructure?: {
    pressureScore: number;
    confirmation: 'SUPPORTIVE' | 'MIXED' | 'UNCONFIRMED';
    liquidationBias: 'UP' | 'DOWN' | 'MIXED' | 'UNAVAILABLE';
    liquidationLongUsd: number;
    liquidationShortUsd: number;
    liquidationCount: number;
    summary: string;
  };
  crowdSentiment: CrowdSentiment;
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
  liquidationMagnet?: LiquidationMagnetResult;
}

/**
 * 行情按用途分层缓存：实时层短缓存，K 线盘中短缓存并在边界复核，衍生指标使用分钟级缓存。
 * 同一轮并发请求继续合并，避免多个 Agent 重复访问 OKX。
 */
const REALTIME_CACHE_TTL_MS = 2500;
const DERIVATIVES_CACHE_TTL_MS = 60_000;
const CANDLE_CACHE_TTL_MS = 10_000;
const CANDLE_BOUNDARY_GRACE_MS = 5_000;
const DAILY_CANDLE_PERIOD_MS = 24 * 60 * 60_000;
const OKX_DAILY_CANDLE_OFFSET_MS = 8 * 60 * 60_000;
const MICROSTRUCTURE_CACHE_TTL_MS = 5_000;
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
  oiDelta1hWindow: CryptoOIWindow | null;
  longShortRatio?: number;
  dataQuality: Pick<CryptoDataQuality, 'fundingRate' | 'oiDelta1h' | 'longShortRatio'>;
}>>();
const candleCache = new Map<string, CandleCacheEntry>();
const microstructureCache = new Map<string, CacheEntry<CryptoMicrostructure>>();
const inFlightRequests = new Map<string, Promise<CryptoMarketSnapshot | null>>();
export interface CryptoQuote {
  symbol: string;
  instId: string;
  price: number;
  open24h: number | null;
  high24h: number | null;
  low24h: number | null;
  change24hPercent: number | null;
  volume24hBase: number | null;
  observedAt: string | null;
  fetchedAt: string;
}
const quoteCache = new Map<string, CacheEntry<CryptoQuote>>();
const quoteRequests = new Map<string, Promise<CryptoQuote | null>>();

export async function getCryptoQuoteData(rawSymbol: string): Promise<CryptoQuote | null> {
  const { ccy, instId } = normalizeSymbol(rawSymbol);
  const cached = quoteCache.get(instId);
  if (cached && Date.now() - cached.fetchedAt < REALTIME_CACHE_TTL_MS) return cached.value;
  const pending = quoteRequests.get(instId);
  if (pending) return pending;
  const task = (async () => {
    try {
      const response = await smartFetch(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`, { timeoutMs: 5000 });
      if (!response.ok) return null;
      const payload = await response.json();
      const ticker = payload.code === '0' ? payload.data?.[0] : null;
      const positive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
      const price = positive(ticker?.last);
      if (!price) return null;
      const open24h = positive(ticker.open24h);
      const fetchedAt = Date.now();
      const observedMs = Number(ticker.ts);
      const quote = {
        symbol: ccy, instId, price, open24h,
        high24h: positive(ticker.high24h), low24h: positive(ticker.low24h),
        volume24hBase: Number.isFinite(Number(ticker.volCcy24h)) && ticker.volCcy24h !== '' && ticker.volCcy24h != null ? Number(ticker.volCcy24h) : null,
        change24hPercent: open24h ? (price - open24h) / open24h * 100 : null,
        observedAt: Number.isFinite(observedMs) && observedMs > 0 && observedMs <= 8.64e15 ? new Date(observedMs).toISOString() : null,
        fetchedAt: new Date(fetchedAt).toISOString(),
      };
      if (quoteCache.size >= 300) quoteCache.delete(quoteCache.keys().next().value!);
      quoteCache.set(instId, { fetchedAt, value: quote });
      return quote;
    } catch {
      return null;
    } finally {
      quoteRequests.delete(instId);
    }
  })();
  quoteRequests.set(instId, task);
  return task;
}

export function clearCryptoCache(): void {
  realtimeCache.clear();
  derivativesCache.clear();
  candleCache.clear();
  microstructureCache.clear();
  inFlightRequests.clear();
  quoteCache.clear();
  quoteRequests.clear();
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
    const [realtime, derivatives, candles15m, candles1h, candles4h, candles1d, microstructure] = await Promise.all([
      getRealtimeData(instId, now),
      getDerivativesData(ccy, instId, now),
      getCandles(instId, '15m', 15 * 60_000, now),
      getCandles(instId, '1H', 60 * 60_000, now),
      getCandles(instId, '4H', 4 * 60 * 60_000, now),
      getCandles(instId, '1D', DAILY_CANDLE_PERIOD_MS, now),
      getMicrostructureData(instId, now),
    ]);
    if (!realtime || realtime.value.price <= 0) return null;
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
      candles15m: candles15m.slice(0, 100),
      candles1h: candles1h.slice(0, 100),
      candles4h: candles4h.slice(0, 100),
      candles1d: candles1d.slice(0, 10),
      dailyStructure: candles1d.length ? analyzeStructure(candles1d, '1D') : null,
      microstructure: microstructure.value,
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
        ...microstructure.value.dataQuality,
      },
    };
  } catch (err: any) {
    console.error(`[getCryptoMarketData] Failed to fetch data for ${rawSymbol}:`, err?.message || err);
    return null;
  }
}

async function getMicrostructureData(instId: string, now: number): Promise<CacheEntry<CryptoMicrostructure>> {
  const cached = microstructureCache.get(instId);
  if (cached && now - cached.fetchedAt < MICROSTRUCTURE_CACHE_TTL_MS) return cached;

  const instFamily = instId.replace(/-SWAP$/, '');
  const [bookRes, tradesRes, liquidationRes, instrumentRes] = await Promise.allSettled([
    smartFetch(`https://www.okx.com/api/v5/market/books?instId=${instId}&sz=20`, { timeoutMs: 5000 }),
    smartFetch(`https://www.okx.com/api/v5/market/trades?instId=${instId}&limit=100`, { timeoutMs: 5000 }),
    smartFetch(`https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&instFamily=${instFamily}&instId=${instId}&state=filled&limit=100`, { timeoutMs: 5000 }),
    smartFetch(`https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${instId}`, { timeoutMs: 5000 }),
  ]);

  let bidDepthUsd = 0;
  let askDepthUsd = 0;
  let orderBookAvailable = false;
  if (bookRes.status === 'fulfilled' && bookRes.value.ok) {
    const book = (await bookRes.value.json().catch(() => ({}))).data?.[0];
    const sumDepth = (levels: any[]) => (Array.isArray(levels) ? levels : []).reduce((total, level) => {
      const price = Number(level?.[0]);
      const size = Number(level?.[1]);
      return total + (Number.isFinite(price) && Number.isFinite(size) ? price * size : 0);
    }, 0);
    bidDepthUsd = sumDepth(book?.bids);
    askDepthUsd = sumDepth(book?.asks);
    orderBookAvailable = bidDepthUsd > 0 || askDepthUsd > 0;
  }

  let aggressiveBuyUsd = 0;
  let aggressiveSellUsd = 0;
  let tradesAvailable = false;
  if (tradesRes.status === 'fulfilled' && tradesRes.value.ok) {
    const trades = (await tradesRes.value.json().catch(() => ({}))).data;
    if (Array.isArray(trades)) {
      for (const trade of trades) {
        const value = Number(trade?.px) * Number(trade?.sz);
        if (!Number.isFinite(value) || value <= 0) continue;
        if (trade?.side === 'buy') aggressiveBuyUsd += value;
        if (trade?.side === 'sell') aggressiveSellUsd += value;
      }
      tradesAvailable = trades.length > 0;
    }
  }

  let liquidationLongUsd = 0;
  let liquidationShortUsd = 0;
  let liquidationCount = 0;
  let liquidationSampleFrom: string | null = null;
  let liquidationSampleTo: string | null = null;
  let liquidationsAvailable = false;
  const instrumentPayload = instrumentRes.status === 'fulfilled' && instrumentRes.value.ok
    ? await instrumentRes.value.json().catch(() => ({})) : {};
  const instrument = instrumentPayload.code === '0' && Array.isArray(instrumentPayload.data)
    ? instrumentPayload.data.find((row: any) => row?.instId === instId) : null;
  const contractValue = Number(instrument?.ctVal) * Number(instrument?.ctMult);
  const validUnit = instrument?.ctType === 'linear' && instrument?.settleCcy === 'USDT'
    && instrument?.ctValCcy === instFamily.slice(0, -5) && Number.isFinite(contractValue) && contractValue > 0;
  if (liquidationRes.status === 'fulfilled' && liquidationRes.value.ok) {
    const payload = await liquidationRes.value.json().catch(() => ({}));
    const groups = payload.data;
    const validPayload = payload.code === '0' && Array.isArray(groups);
    const details = validPayload
      ? groups.filter((group: any) => group?.instId === instId).flatMap((group: any) => Array.isArray(group?.details) ? group.details : [])
      : [];
    let invalidDetails = false;
    const times: number[] = [];
    for (const detail of details) {
      const price = Number(detail?.bkPx), size = Number(detail?.sz), timestamp = Number(detail?.ts);
      if (!validUnit || !Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size <= 0
        || !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now
        || !['long', 'short'].includes(detail?.posSide)) { invalidDetails = true; continue; }
      const value = price * size * contractValue;
      if (!Number.isFinite(value)) { invalidDetails = true; continue; }
      if (detail.posSide === 'long') liquidationLongUsd += value;
      else liquidationShortUsd += value;
      liquidationCount += 1;
      times.push(timestamp);
    }
    liquidationsAvailable = validPayload && validUnit && !invalidDetails
      && (groups.length === 0 || groups.every((group: any) => group?.instId === instId && Array.isArray(group?.details)));
    if (times.length) {
      liquidationSampleFrom = new Date(Math.min(...times)).toISOString();
      liquidationSampleTo = new Date(Math.max(...times)).toISOString();
    }
  }

  const entry = {
    fetchedAt: Date.now(),
    value: {
      bidDepthUsd,
      askDepthUsd,
      depthImbalance: bidDepthUsd + askDepthUsd > 0
        ? (bidDepthUsd - askDepthUsd) / (bidDepthUsd + askDepthUsd)
        : 0,
      aggressiveBuyUsd,
      aggressiveSellUsd,
      liquidationLongUsd,
      liquidationShortUsd,
      liquidationCount,
      liquidationSampleFrom,
      liquidationSampleTo,
      fetchedAt: new Date().toISOString(),
      dataQuality: {
        orderBook: orderBookAvailable,
        trades: tradesAvailable,
        liquidations: liquidationsAvailable,
      },
    },
  };
  microstructureCache.set(instId, entry);
  return entry;
}

async function getRealtimeData(instId: string, now: number) {
  const cached = realtimeCache.get(instId);
  if (cached && now - cached.fetchedAt < REALTIME_CACHE_TTL_MS) return cached;
  const [tickerRes, oiRes] = await Promise.allSettled([
    getCryptoQuoteData(instId),
    smartFetch(`https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${instId}`, { timeoutMs: 5000 }),
  ]);
  let price = 0;
  let tickerAvailable = false;
  let open24h = 0;
  let high24h = 0;
  let low24h = 0;
  let vol24hQuote = 0;
  if (tickerRes.status === 'fulfilled') {
    const t = tickerRes.value;
    if (t) {
      price = t.price;
      tickerAvailable = price > 0;
      open24h = t.open24h || 0;
      high24h = t.high24h || 0;
      low24h = t.low24h || 0;
      vol24hQuote = t.volume24hBase || 0;
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
    smartFetch(`https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=${instId}&period=1H&limit=24`, { timeoutMs: 5000 }),
    smartFetch(`https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${ccy}&period=1H`, { timeoutMs: 5000 }),
  ]);
  let fundingRate = 0;
  let fundingRateAvailable = false;
  let nextFundingRate: number | undefined;
  if (frRes.status === 'fulfilled' && frRes.value.ok) {
    const f = (await frRes.value.json().catch(() => ({}))).data?.[0];
    if (f) {
      const parsedFundingRate = parseFloat(f.fundingRate || '');
      fundingRate = Number.isFinite(parsedFundingRate) ? parsedFundingRate : 0;
      fundingRateAvailable = Number.isFinite(parsedFundingRate);
      const parsedNextFundingRate = parseFloat(f.nextFundingRate || '');
      if (Number.isFinite(parsedNextFundingRate)) nextFundingRate = parsedNextFundingRate;
    }
  }
  let oiDelta1hPercent = 0;
  let oiDelta1hWindow: CryptoOIWindow | null = null;
  let oiDeltaAvailable = false;
  if (rubikOiRes.status === 'fulfilled' && rubikOiRes.value.ok) {
    const payload = await rubikOiRes.value.json().catch(() => ({}));
    const list = payload.code === '0' && Array.isArray(payload.data) ? payload.data : [];
    // 历史接口 row[1] 是该合约持仓张数；不用随币价变化的美元名义金额。
    // 比较交易所实际相隔一小时的两个采样点；抓取时间不能替代统计时点。
    const points = list.filter(Array.isArray).map((row: any[]) => ({ at: Number(row[0]), oi: Number(row[1]) }))
      .filter((point: { at: number; oi: number }) => Number.isFinite(point.at) && point.at > 0 && point.at <= now
        && Number.isFinite(point.oi) && point.oi > 0)
      .sort((a: { at: number }, b: { at: number }) => b.at - a.at);
    const current = points[0];
    const previous = current && points.find((point: { at: number }) => point.at === current.at - 3_600_000);
    if (current && previous) {
      const delta = ((current.oi - previous.oi) / previous.oi) * 100;
      if (Number.isFinite(delta)) {
        oiDelta1hPercent = delta;
        oiDelta1hWindow = { from: new Date(previous.at).toISOString(), to: new Date(current.at).toISOString(),
          period: '1H', scope: 'OKX_INSTRUMENT_CONTRACTS', instId, metric: 'CONTRACTS', ccy };
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
      fundingRate, nextFundingRate, oiDelta1hPercent, oiDelta1hWindow, longShortRatio,
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
  const daily = bar === '1D';
  const offset = daily ? OKX_DAILY_CANDLE_OFFSET_MS : 0;
  const periodStartMs = Math.floor((now + offset) / periodMs) * periodMs - offset;
  const key = `${instId}:${bar}`;
  const cached = candleCache.get(key);
  // 未收盘 OHLCV 也需要刷新；周期已切换时不复用上一周期的列表。
  // 若边界刚过就取过数据，宽限期后再取一次，核验交易所最终收盘标记。
  const boundaryReadyAt = periodStartMs + CANDLE_BOUNDARY_GRACE_MS;
  const dailyConfirmed = daily && Boolean(cached?.value.length);
  const needsBoundaryConfirmation = !dailyConfirmed && cached && cached.fetchedAt < boundaryReadyAt && now >= boundaryReadyAt;
  const ttl = dailyConfirmed ? DAILY_CANDLE_PERIOD_MS : CANDLE_CACHE_TTL_MS;
  if (cached && cached.periodStartMs === periodStartMs
    && now - cached.fetchedAt < ttl && !needsBoundaryConfirmation) {
    return cached.value;
  }
  const fallback = daily && cached?.periodStartMs !== periodStartMs ? [] : cached?.value || [];
  const response = await smartFetch(`https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=100`, { timeoutMs: 5000 }).catch(() => null);
  if (!response?.ok) return fallback;
  const json = await response.json().catch(() => ({}));
  if (json.code !== '0' || !Array.isArray(json.data) || json.data.length === 0) return fallback;
  const rawList = json.data;
  const candles = rawList.filter(Array.isArray).map((item: any[]) => {
    const startTimeMs = parseInt(item[0], 10);
    return {
      time: daily
        ? new Date(startTimeMs).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })
        : new Date(startTimeMs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      startTimeMs,
      isClosed: item[8] === '1',
      open: parseFloat(item[1]),
      high: parseFloat(item[2]),
      low: parseFloat(item[3]),
      close: parseFloat(item[4]),
      vol: parseFloat(item[5] || '0'),
    };
  }).filter((candle: CryptoCandle) => Number.isFinite(candle.startTimeMs) && candle.startTimeMs > 0
    && [candle.open, candle.high, candle.low, candle.close].every(value => Number.isFinite(value) && value > 0)
    && Number.isFinite(candle.vol) && candle.vol >= 0);
  // 上游空数据或异常数据不能清空可用历史，也不能将旧数据的时间刷新为现在。
  if (candles.length === 0) return fallback;
  let value = candles;
  if (daily) {
    const previousDayStart = periodStartMs - periodMs;
    const closed = candles.filter(candle => candle.isClosed && candle.startTimeMs <= previousDayStart
      && (candle.startTimeMs + offset) % periodMs === 0)
      .sort((a, b) => b.startTimeMs - a.startTimeMs);
    value = closed.some(candle => candle.startTimeMs === previousDayStart) ? closed : [];
  }
  candleCache.set(key, { fetchedAt: Date.now(), value, periodStartMs, periodMs });
  return value;
}
