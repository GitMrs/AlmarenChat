import { getCryptoMarketData, getCryptoQuoteData, normalizeSymbol } from './okx-service';

export const cryptoMarketTools = ['crypto_quote', 'crypto_market_snapshot'] as const;

export async function queryCryptoMarket(tool: string, args: { symbol: string }) {
  if (!cryptoMarketTools.includes(tool as typeof cryptoMarketTools[number])) throw new Error('不支持的行情工具');
  if (!/^[a-z0-9]{2,12}(?:[-_/]?USDT)?(?:[-_/]?SWAP)?$/i.test(args.symbol)) throw new Error('无效的币种代码');
  const { ccy } = normalizeSymbol(args.symbol);
  if (tool === 'crypto_quote') {
    const quote = await getCryptoQuoteData(ccy);
    return quote ? { source: 'OKX', market: 'USDT perpetual swap', ...quote } : null;
  }
  const snapshot = await getCryptoMarketData(ccy);
  if (!snapshot) return null;
  const quality = snapshot.dataQuality;
  return {
    source: 'OKX', market: 'USDT perpetual swap',
    symbol: snapshot.symbol, instId: snapshot.instId, price: snapshot.price,
    realtimeFetchedAt: snapshot.realtimeFetchedAt,
    derivativesFetchedAt: snapshot.derivativesFetchedAt,
    structureFetchedAt: snapshot.structureFetchedAt,
    dataQuality: quality,
    open24h: snapshot.open24h || null, high24h: snapshot.high24h || null, low24h: snapshot.low24h || null,
    oiUsd: quality.openInterest ? snapshot.oiUsd : null,
    fundingRate: quality.fundingRate ? snapshot.fundingRate : null,
    nextFundingRate: quality.fundingRate ? snapshot.nextFundingRate ?? null : null,
    oiDelta1hPercent: quality.oiDelta1h ? snapshot.oiDelta1hPercent : null,
    longShortRatio: quality.longShortRatio ? snapshot.longShortRatio ?? null : null,
    candles15m: snapshot.candles15m, candles1h: snapshot.candles1h, candles4h: snapshot.candles4h,
    priceDelta15mPercent: quality.candles15m ? snapshot.priceDelta15mPercent : null,
    priceDelta1hPercent: quality.candles1h ? snapshot.priceDelta1hPercent : null,
    priceDelta4hPercent: quality.candles4h ? snapshot.priceDelta4hPercent : null,
    microstructure: {
      fetchedAt: snapshot.microstructure.fetchedAt,
      depthImbalance: quality.orderBook ? snapshot.microstructure.depthImbalance : null,
      liquidationCount: quality.liquidations ? snapshot.microstructure.liquidationCount : null,
    },
  };
}
