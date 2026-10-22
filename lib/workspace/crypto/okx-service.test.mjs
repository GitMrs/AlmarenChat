import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractCryptoSymbolFromText,
  normalizeSymbol,
  analyzeCryptoTrap,
  estimateLiquidationMagnet,
  formatCryptoContextForPrompt,
} from './okx-analysis.mjs';

test('extractCryptoSymbolFromText extracts standard symbols, pairs, and aliases', () => {
  assert.equal(extractCryptoSymbolFromText('帮我看看 BTC 目前在 4H 和 1H 的结构'), 'BTC');
  assert.equal(extractCryptoSymbolFromText('我想在 SOL 回踩时找机会开多'), 'SOL');
  assert.equal(extractCryptoSymbolFromText('看看 sol-usdt 的费率'), 'SOL');
  assert.equal(extractCryptoSymbolFromText('刚才以太坊放量急拉'), 'ETH');
  assert.equal(extractCryptoSymbolFromText('大饼跌破关键支撑位了吗'), 'BTC');
  assert.equal(extractCryptoSymbolFromText('狗狗币可以追吗'), 'DOGE');
  assert.equal(extractCryptoSymbolFromText('PEPE/USDT 准备开空'), 'PEPE');
  assert.equal(extractCryptoSymbolFromText('今天北京天气怎么样'), null);
  assert.equal(extractCryptoSymbolFromText(''), null);
});

test('normalizeSymbol produces valid OKX SWAP instrument ID', () => {
  assert.deepEqual(normalizeSymbol('BTC'), { ccy: 'BTC', instId: 'BTC-USDT-SWAP' });
  assert.deepEqual(normalizeSymbol('sol-usdt'), { ccy: 'SOL', instId: 'SOL-USDT-SWAP' });
  assert.deepEqual(normalizeSymbol('eth_usdt_swap'), { ccy: 'ETH', instId: 'ETH-USDT-SWAP' });
  assert.deepEqual(normalizeSymbol(''), { ccy: 'BTC', instId: 'BTC-USDT-SWAP' });
});

test('analyzeCryptoTrap accurately identifies 5 market trap scenarios with location and wick confluence', () => {
  // 1. Bull Trap: Price UP + OI DOWN at Resistance (前高流动性猎杀)
  const bullTrap = analyzeCryptoTrap({
    price: 145.5,
    high24h: 146.0,
    low24h: 138.0,
    priceDelta1hPercent: 1.5,
    oiDelta1hPercent: -3.0,
    fundingRate: 0.0003,
    candles15m: [{ time: '11:00', open: 144.5, high: 146.0, low: 144.0, close: 144.8, vol: 1000 }],
  });
  assert.equal(bullTrap.trapType, 'BULL_TRAP_DIVERGENCE');
  assert.match(bullTrap.trapTitle, /流动性掠夺/);
  assert.match(bullTrap.divergenceDescription, /空头平仓止损被动买盘推动/);
  assert.ok(bullTrap.confidenceScore >= 90);
  assert.match(bullTrap.locationDesc, /顶部阻力/);
  assert.ok(bullTrap.checklist.length >= 3);

  // 2. Deleveraging Cascade: Price DOWN + OI DOWN
  const deleveraging = analyzeCryptoTrap({
    price: 140.0,
    high24h: 146.0,
    low24h: 138.0,
    priceDelta1hPercent: -2.0,
    oiDelta1hPercent: -4.5,
    fundingRate: 0.0001,
  });
  assert.equal(deleveraging.trapType, 'DELEVERAGING_CASCADE');
  assert.match(deleveraging.trapTitle, /去杠杆/);
  assert.match(deleveraging.suggestedAction, /飞刀切勿用手接/);

  // 3. Bear Trap / Absorption: Price DOWN + OI UP at Support
  const bearTrap = analyzeCryptoTrap({
    price: 138.4,
    high24h: 146.0,
    low24h: 138.0,
    priceDelta1hPercent: -1.2,
    oiDelta1hPercent: 3.5,
    fundingRate: -0.0001,
    candles15m: [{ time: '11:00', open: 140.0, high: 140.2, low: 138.0, close: 139.5, vol: 1500 }],
  });
  assert.equal(bearTrap.trapType, 'BEAR_TRAP_DIVERGENCE');
  assert.match(bearTrap.trapTitle, /大资金托单吸筹/);
  assert.ok(bearTrap.confidenceScore >= 90);

  // 4. Genuine Breakout: Price UP + OI UP
  const genuine = analyzeCryptoTrap({
    price: 147.0,
    high24h: 146.0,
    low24h: 138.0,
    priceDelta1hPercent: 2.2,
    oiDelta1hPercent: 4.0,
    fundingRate: 0.0001,
  });
  assert.equal(genuine.trapType, 'GENUINE_BREAKOUT');
  assert.match(genuine.trapTitle, /真实主力增量突破/);

  // 5. Consolidation: Stable in Mid-Range
  const consolidation = analyzeCryptoTrap({
    price: 142.0,
    high24h: 146.0,
    low24h: 138.0,
    priceDelta1hPercent: 0.2,
    oiDelta1hPercent: 0.1,
    fundingRate: 0.00008,
  });
  assert.equal(consolidation.trapType, 'HEALTHY_CONSOLIDATION');
  assert.match(consolidation.trapTitle, /箱体中性筹码换手/);
});

test('formatCryptoContextForPrompt outputs complete real-time radar block with confidence and checklist', () => {
  const formatted = formatCryptoContextForPrompt({
    symbol: 'SOL',
    instId: 'SOL-USDT-SWAP',
    price: 145.5,
    high24h: 146.0,
    low24h: 139.0,
    vol24hQuote: 520000000,
    fundingRate: 0.00035,
    oiUsd: 850000000,
    oiDelta1hPercent: -2.5,
    longShortRatio: 1.68,
    candles15m: [{ time: '10:30', open: 144.5, high: 146.0, low: 144.0, close: 144.8, vol: 1000 }],
    candles1h: [{ time: '10:00', open: 140.0, high: 146.0, low: 139.5, close: 144.8, vol: 5000 }],
    candles4h: [{ time: '08:00', open: 138.0, high: 146.0, low: 137.5, close: 144.8, vol: 20000 }],
    priceDelta1hPercent: 1.78,
    priceDelta4hPercent: 3.26,
  });

  assert.match(formatted, /OKX 衍生品实盘盘面与量价雷达/);
  assert.match(formatted, /SOL-USDT-SWAP/);
  assert.match(formatted, /145\.5/);
  assert.match(formatted, /流动性掠夺/);
  assert.match(formatted, /置信度打分/);
  assert.match(formatted, /多维共振检验/);
  assert.match(formatted, /操作指导纪律/);
});

test('analyzeCryptoTrap ignores an unclosed candle when checking wick confirmation', () => {
  const result = analyzeCryptoTrap({
    price: 145.5,
    high24h: 146.0,
    low24h: 138.0,
    priceDelta1hPercent: 1.5,
    oiDelta1hPercent: -3.0,
    fundingRate: 0.0003,
    candles15m: [
      { time: '11:15', isClosed: false, open: 144.5, high: 146.0, low: 144.0, close: 144.8 },
      { time: '11:00', isClosed: true, open: 144.5, high: 145.0, low: 144.0, close: 144.8 },
    ],
  });

  assert.doesNotMatch(result.checklist.join('\n'), /上影线插针拒涨信号/);
});

test('estimateLiquidationMagnet calculates tiers, crowd contrarian signal, and downside magnet on heavy long bias', () => {
  const magnet = estimateLiquidationMagnet({
    price: 66000,
    high24h: 67200,
    low24h: 64800,
    oiUsd: 1200000000,
    longShortRatio: 1.6,
    fundingRate: 0.00025,
    nextFundingRate: 0.00035,
    dataQuality: { openInterest: true, longShortRatio: true },
  });

  assert.ok(magnet);
  assert.equal(magnet.magnetBias, 'DOWN_SWEEP');
  assert.match(magnet.biasTitle, /下方多头清算压力估算/);
  assert.ok(magnet.intensityScore >= 60);
  assert.ok(magnet.longClusters.tier50x.price < 66000);
  assert.ok(magnet.longClusters.tier20x.price < magnet.longClusters.tier50x.price);
  assert.ok(magnet.shortClusters.tier50x.price > 66000);
  assert.ok(magnet.shortClusters.tier20x.price > magnet.shortClusters.tier50x.price);
  assert.equal(magnet.crowdSentiment.crowdState, 'HEAVILY_LONG');
  assert.match(magnet.crowdSentiment.contrarianSignal, /反向指标/);
  assert.equal(magnet.fundingRateShift.trend, 'INCREASING');
});

test('estimateLiquidationMagnet refuses to infer liquidation pressure without explicit data quality', () => {
  assert.equal(estimateLiquidationMagnet({
    price: 66000,
    oiUsd: 1200000000,
    longShortRatio: 1.6,
  }), null);
});

test('analyzeCryptoTrap only confirms pressure when microstructure supports the account-ratio signal', () => {
  const result = analyzeCryptoTrap({
    price: 66000,
    high24h: 67200,
    low24h: 64800,
    oiUsd: 1200000000,
    longShortRatio: 1.6,
    fundingRate: 0.00025,
    priceDelta1hPercent: 0.2,
    oiDelta1hPercent: 0.1,
    dataQuality: { openInterest: true, longShortRatio: true },
    microstructure: {
      bidDepthUsd: 100000,
      askDepthUsd: 300000,
      depthImbalance: -0.5,
      aggressiveBuyUsd: 100000,
      aggressiveSellUsd: 300000,
      liquidationLongUsd: 300000,
      liquidationShortUsd: 100000,
      liquidationCount: 4,
      dataQuality: { liquidations: true },
    },
  });

  assert.equal(result.liquidationMagnet?.microstructure?.confirmation, 'SUPPORTIVE');
  assert.equal(result.liquidationMagnet?.microstructure?.liquidationBias, 'DOWN');
  assert.ok((result.liquidationMagnet?.microstructure?.pressureScore || 0) > 50);
});
