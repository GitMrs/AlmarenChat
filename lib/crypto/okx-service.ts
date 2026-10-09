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
  priceDelta1hPercent: number;
  priceDelta4hPercent: number;
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
 * 2.5 秒超高频防抖缓存 + 并发请求合并 (In-Flight Deduplication)
 * - 杜绝 30 秒过长 TTL 带来的滞后行情风险（币圈秒级插针与流动性猎杀决不允许半分钟级延迟）
 * - 解决同一轮对话中多个 Agent 并发评估时对 OKX 接口产生重复突发请求 (burst calls)
 */
const SNAPSHOT_CACHE_TTL_MS = 2500;
const snapshotCache = new Map<string, { timestamp: number; snapshot: CryptoMarketSnapshot }>();
const inFlightRequests = new Map<string, Promise<CryptoMarketSnapshot | null>>();

export function clearCryptoCache(): void {
  snapshotCache.clear();
  inFlightRequests.clear();
}

/**
 * 从 OKX 获取指定币种的完整衍生品与多周期行情
 */
export async function getCryptoMarketData(rawSymbol: string): Promise<CryptoMarketSnapshot | null> {
  const { ccy, instId } = normalizeSymbol(rawSymbol);

  // 1. 命中 2.5 秒微防抖缓存直接返回
  const cached = snapshotCache.get(instId);
  const now = Date.now();
  if (cached && now - cached.timestamp < SNAPSHOT_CACHE_TTL_MS) {
    return cached.snapshot;
  }

  // 2. 如果当前 instId 已有正在进行的网络请求，直接合并复用该 Promise
  const existingPromise = inFlightRequests.get(instId);
  if (existingPromise) {
    return existingPromise;
  }

  // 3. 发起真实网络请求并登记到 inFlightRequests
  const fetchPromise = (async () => {
    try {
      const snapshot = await fetchMarketDataDirect(ccy, instId, rawSymbol);
      if (snapshot) {
        snapshotCache.set(instId, { timestamp: Date.now(), snapshot });
      }
      return snapshot;
    } finally {
      inFlightRequests.delete(instId);
    }
  })();

  inFlightRequests.set(instId, fetchPromise);
  return fetchPromise;
}

async function fetchMarketDataDirect(ccy: string, instId: string, rawSymbol: string): Promise<CryptoMarketSnapshot | null> {

  try {
    const [tickerRes, oiRes, frRes, c15mRes, c1hRes, c4hRes, rubikOiRes, lsRes] = await Promise.allSettled([
      smartFetch(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`, { timeoutMs: 5000 }),
      smartFetch(`https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${instId}`, { timeoutMs: 5000 }),
      smartFetch(`https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`, { timeoutMs: 5000 }),
      smartFetch(`https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=15m&limit=10`, { timeoutMs: 5000 }),
      smartFetch(`https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=1H&limit=10`, { timeoutMs: 5000 }),
      smartFetch(`https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=4H&limit=10`, { timeoutMs: 5000 }),
      smartFetch(`https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-volume?ccy=${ccy}&period=1H`, { timeoutMs: 5000 }),
      smartFetch(`https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${ccy}&period=1H`, { timeoutMs: 5000 }),
    ]);

    // 1. Ticker 数据
    let price = 0;
    let high24h = 0;
    let low24h = 0;
    let vol24hQuote = 0;
    if (tickerRes.status === 'fulfilled' && tickerRes.value.ok) {
      const json = await tickerRes.value.json().catch(() => ({}));
      const t = json.data?.[0];
      if (t) {
        price = parseFloat(t.last || '0');
        high24h = parseFloat(t.high24h || '0');
        low24h = parseFloat(t.low24h || '0');
        vol24hQuote = parseFloat(t.volCcy24h || '0');
      }
    }
    if (price <= 0) {
      return null;
    }

    // 2. 资金费率
    let fundingRate = 0;
    let nextFundingRate: number | undefined;
    if (frRes.status === 'fulfilled' && frRes.value.ok) {
      const json = await frRes.value.json().catch(() => ({}));
      const f = json.data?.[0];
      if (f) {
        fundingRate = parseFloat(f.fundingRate || '0');
        if (f.nextFundingRate) nextFundingRate = parseFloat(f.nextFundingRate);
      }
    }

    // 3. 实时未平仓量 (OI)
    let oiUsd = 0;
    if (oiRes.status === 'fulfilled' && oiRes.value.ok) {
      const json = await oiRes.value.json().catch(() => ({}));
      const o = json.data?.[0];
      if (o) {
        const oiCoins = parseFloat(o.oiCcy || '0');
        oiUsd = oiCoins > 0 ? oiCoins * price : parseFloat(o.oi || '0') * 100;
      }
    }

    // 4. 过去 1 小时 OI 变动比例 (基于 Rubik 数据)
    let oiDelta1hPercent = 0;
    if (rubikOiRes.status === 'fulfilled' && rubikOiRes.value.ok) {
      const json = await rubikOiRes.value.json().catch(() => ({}));
      const list = json.data;
      if (Array.isArray(list) && list.length >= 2) {
        const curOiVal = parseFloat(list[0][1] || '0');
        const prevOiVal = parseFloat(list[1][1] || '0');
        if (prevOiVal > 0) {
          oiDelta1hPercent = ((curOiVal - prevOiVal) / prevOiVal) * 100;
        }
      }
    }

    // 5. 多空账户比
    let longShortRatio: number | undefined;
    if (lsRes.status === 'fulfilled' && lsRes.value.ok) {
      const json = await lsRes.value.json().catch(() => ({}));
      const list = json.data;
      if (Array.isArray(list) && list.length > 0) {
        longShortRatio = parseFloat(list[0][1] || '1');
      }
    }

    // 6. 解析 K 线助手
    const parseCandles = async (settled: PromiseSettledResult<Response>): Promise<CryptoCandle[]> => {
      if (settled.status !== 'fulfilled' || !settled.value.ok) return [];
      const json = await settled.value.json().catch(() => ({}));
      const rawList = Array.isArray(json.data) ? json.data : [];
      return rawList.map((item: any[]) => ({
        time: new Date(parseInt(item[0])).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        vol: parseFloat(item[5] || '0'),
      }));
    };

    const candles15m = await parseCandles(c15mRes);
    const candles1h = await parseCandles(c1hRes);
    const candles4h = await parseCandles(c4hRes);

    // 计算 1H 和 4H 价格涨跌幅
    const priceDelta1hPercent = candles1h.length >= 2 && candles1h[1].close > 0
      ? ((price - candles1h[1].close) / candles1h[1].close) * 100
      : 0;

    const priceDelta4hPercent = candles4h.length >= 2 && candles4h[1].close > 0
      ? ((price - candles4h[1].close) / candles4h[1].close) * 100
      : 0;

    return {
      symbol: ccy,
      instId,
      price,
      high24h,
      low24h,
      vol24hQuote,
      fundingRate,
      nextFundingRate,
      oiUsd,
      oiDelta1hPercent,
      longShortRatio,
      candles15m: candles15m.slice(0, 5),
      candles1h: candles1h.slice(0, 6),
      candles4h: candles4h.slice(0, 6),
      priceDelta1hPercent,
      priceDelta4hPercent,
    };
  } catch (err: any) {
    console.error(`[getCryptoMarketData] Failed to fetch data for ${rawSymbol}:`, err?.message || err);
    return null;
  }
}
