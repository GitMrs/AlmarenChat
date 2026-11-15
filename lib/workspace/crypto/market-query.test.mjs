import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as analysis from './okx-analysis.mjs';
import { classifyCryptoMarketQuery, buildCryptoMarketContext } from './market-query.mjs';

test('market queries distinguish quotes and deeper snapshots', () => {
  for (const message of ['BTC现在多少钱', '看看比特币当前价格', 'BTC现价', 'ETH涨了多少？']) {
    assert.equal(classifyCryptoMarketQuery(message)?.tool, 'crypto_quote', message);
  }
  for (const message of ['分析一下BTC的走势', '帮我看下BTC当前的情况', 'BTC资金费率', 'ETH支撑阻力如何', '看看SOL的1H结构']) {
    assert.equal(classifyCryptoMarketQuery(message)?.tool, 'crypto_market_snapshot', message);
  }
});

test('ordinary chat, definitions, memory commands and historical trading do not query', async () => {
  const history = [{ role: 'user', content: 'BTC现在多少钱' }, { role: 'assistant', content: '报价回复' }];
  for (const message of ['你好', '我昨天买了BTC', 'BTC又跌了，我好烦', '我喜欢BTC', 'BTC是什么', '解释一下BTC资金费率', '昨天BTC价格多少', '不用查BTC现在价格', '帮我记一下BTC价格', '你觉得我现在心情怎么样']) {
    assert.equal(classifyCryptoMarketQuery(message), null, message);
    let calls = 0;
    await buildCryptoMarketContext({ message, history: [], query: async () => { calls++; } });
    assert.equal(calls, 0);
  }
  assert.equal(classifyCryptoMarketQuery('今天吃什么', history), null);
  assert.equal(classifyCryptoMarketQuery('你觉得我现在心情怎么样', history), null);
  assert.equal(classifyCryptoMarketQuery('这个模型的价格怎么样', history), null);
});

test('only immediate market follow-ups inherit the symbol and can upgrade depth', () => {
  const history = [{ role: 'user', content: 'ETH现在多少钱' }, { role: 'assistant', content: 'OKX永续报价' }];
  assert.deepEqual(classifyCryptoMarketQuery('再深入分析看看', history), { tool: 'crypto_market_snapshot', symbol: 'ETH' });
  assert.deepEqual(classifyCryptoMarketQuery('那现在价格呢', history), { tool: 'crypto_quote', symbol: 'ETH' });
  assert.equal(classifyCryptoMarketQuery('再深入看看', [...history, { role: 'user', content: '今晚想吃面' }]), null);
  assert.deepEqual(classifyCryptoMarketQuery('帮我看看行情'), { tool: 'crypto_market_snapshot', symbol: null });
  assert.equal(classifyCryptoMarketQuery('看看当前价格'), null);
});

test('missing symbols and upstream failures do not become invented market data', async () => {
  let calls = 0;
  const missing = await buildCryptoMarketContext({ message: '看看行情', query: async () => { calls++; } });
  assert.match(missing, /询问用户/);
  assert.equal(calls, 0);
  const failed = await buildCryptoMarketContext({ message: 'BTC现价', query: async () => null });
  assert.match(failed, /查询失败/);
  const success = await buildCryptoMarketContext({ message: 'BTC现价', query: async (tool, args) => {
    assert.equal(tool, 'crypto_quote');
    assert.equal(args.symbol, 'BTC');
    return { source: 'OKX', price: 100, fetchedAt: 'time' };
  } });
  assert.match(success, /不是现货/);
  assert.match(success, /"price":100/);
  assert.match(success, /不包含用户仓位/);
});

async function loadService(fetcher, clock = Date) {
  const source = await readFile(new URL('./okx-service.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, console, Date: clock, Map, Promise,
    require: (name) => name.includes('proxy') ? { smartFetch: fetcher } : analysis,
  });
  return exports;
}

const candlePeriods = { '15m': 15 * 60_000, '1H': 60 * 60_000, '4H': 4 * 60 * 60_000 };
const candleFields = { '15m': 'candles15m', '1H': 'candles1h', '4H': 'candles4h' };
const candleRow = (at, { high = 105, low = 95, close = 101, vol = 10, closed = false } = {}) =>
  [String(at), '100', String(high), String(low), String(close), String(vol), '0', '0', closed ? '1' : '0'];

async function candleHarness(initialTime) {
  let now = Date.parse(initialTime);
  const clock = class extends Date { static now() { return now; } };
  const requests = [];
  let candleReply = ({ bar }) => ({ code: '0', data: [candleRow(Math.floor(now / candlePeriods[bar]) * candlePeriods[bar])] });
  const service = await loadService(async rawUrl => {
    const url = new URL(rawUrl);
    if (url.pathname.endsWith('/candles')) {
      const bar = url.searchParams.get('bar');
      requests.push(bar);
      const payload = candleReply({ bar, now });
      return payload === null ? { ok: false } : { ok: true, json: async () => payload };
    }
    return { ok: true, json: async () => ({ code: '0', data: url.pathname.endsWith('/ticker') ? [{ last: '101' }] : [] }) };
  }, clock);
  return { service, requests, advance: ms => { now += ms; }, reply: fn => { candleReply = fn; } };
}

test('open candles refresh OHLCV within their period, reuse short cache and merge concurrent readers', async () => {
  const h = await candleHarness('2026-11-15T02:10:00Z');
  const first = await h.service.getCryptoMarketData('BTC');
  assert.equal(h.requests.length, 3);
  h.advance(6000);
  await h.service.getCryptoMarketData('BTC');
  assert.equal(h.requests.length, 3, 'short cache avoids fetching candles on every UI poll');
  h.reply(({ bar, now }) => ({ code: '0', data: [candleRow(Math.floor(now / candlePeriods[bar]) * candlePeriods[bar], {
    high: 110, low: 90, close: 99, vol: 30,
  })] }));
  h.advance(4000);
  const [updated, concurrent] = await Promise.all([h.service.getCryptoMarketData('BTC'), h.service.getCryptoMarketData('BTC')]);
  assert.equal(h.requests.length, 6);
  assert.equal(updated, concurrent);
  for (const field of ['candles15m', 'candles1h', 'candles4h']) {
    const old = first[field][0], current = updated[field][0];
    assert.equal(current.startTimeMs, old.startTimeMs);
    assert.equal(current.open, old.open);
    assert.equal(current.high, 110);
    assert.equal(current.low, 90);
    assert.equal(current.close, 99, 'breakout can retrace while the candle is still open');
    assert.equal(current.vol, 30);
    assert.equal(current.isClosed, false, 'refreshing a candle must not confirm a signal');
  }
  assert.notEqual(updated.structureFetchedAt, first.structureFetchedAt);
});

test('period rollover bypasses short cache and rechecks delayed exchange close flags after the grace period', async () => {
  const h = await candleHarness('2026-11-15T03:59:59Z');
  const first = await h.service.getCryptoMarketData('BTC');
  h.advance(2000);
  h.reply(({ bar }) => ({ code: '0', data: [candleRow(first[candleFields[bar]][0].startTimeMs)] }));
  const delayed = await h.service.getCryptoMarketData('BTC');
  assert.equal(h.requests.length, 6, 'new period must fetch even when the last request was two seconds ago');
  assert.equal(delayed.candles15m[0].isClosed, false, 'local clock alone cannot finalize an exchange candle');
  h.advance(4000);
  h.reply(({ bar, now }) => {
    const period = candlePeriods[bar], at = Math.floor(now / period) * period;
    return { code: '0', data: [candleRow(at), candleRow(at - period, { closed: true, close: 102 })] };
  });
  const confirmed = await h.service.getCryptoMarketData('BTC');
  assert.equal(h.requests.length, 9, 'boundary grace recheck must bypass the ten-second cache');
  for (const field of ['candles15m', 'candles1h', 'candles4h']) {
    assert.equal(confirmed[field][0].isClosed, false);
    assert.equal(confirmed[field][1].isClosed, true);
    assert.equal(confirmed[field][1].startTimeMs, first[field][0].startTimeMs);
    assert.equal(confirmed[field][1].close, 102);
  }
});

test('failed or invalid candle refreshes preserve historical values and timestamps, and allow immediate retry', async () => {
  const h = await candleHarness('2026-11-15T02:10:00Z');
  const first = await h.service.getCryptoMarketData('BTC');
  for (const payload of [null, { code: '50011', data: [] }, { code: '0', data: [] }, { code: '0', data: [null, ['bad', 'NaN']] }]) {
    h.advance(11_000);
    h.reply(() => payload);
    const fallback = await h.service.getCryptoMarketData('BTC');
    assert.deepEqual(fallback.candles15m, first.candles15m);
    assert.deepEqual(fallback.candles1h, first.candles1h);
    assert.deepEqual(fallback.candles4h, first.candles4h);
    assert.equal(fallback.structureFetchedAt, first.structureFetchedAt, 'failed refresh must not make old candles appear fresh');
  }
  const count = h.requests.length;
  h.reply(({ bar, now }) => ({ code: '0', data: [candleRow(Math.floor(now / candlePeriods[bar]) * candlePeriods[bar], { close: 103 })] }));
  const recovered = await h.service.getCryptoMarketData('BTC');
  assert.equal(h.requests.length, count + 3, 'failure does not restart the cache TTL');
  assert.equal(recovered.candles15m[0].close, 103);
});

test('quote only fetches ticker, merges concurrent requests and shares ticker with snapshots', async () => {
  const paths = [];
  const service = await loadService(async (url) => {
    const path = new URL(url).pathname;
    paths.push(path);
    return { ok: true, json: async () => ({ code: '0', data: path.endsWith('/ticker')
      ? [{ last: '100', open24h: '80', high24h: '110', low24h: '75', volCcy24h: '5', ts: '1700000000000' }]
      : [] }) };
  });
  const [quote, concurrent] = await Promise.all([service.getCryptoQuoteData('BTC'), service.getCryptoQuoteData('BTC')]);
  assert.equal(paths.length, 1);
  assert.equal(quote.price, 100);
  assert.equal(quote.change24hPercent, 25);
  assert.equal(concurrent, quote);
  await service.getCryptoQuoteData('BTC');
  assert.equal(paths.length, 1);
  const snapshot = await service.getCryptoMarketData('BTC');
  assert.equal(snapshot.price, 100);
  assert.equal(paths.filter((path) => path.endsWith('/ticker')).length, 1);
  assert.ok(paths.some((path) => path.endsWith('/candles')));
  service.clearCryptoCache();
  await service.getCryptoQuoteData('BTC');
  assert.equal(paths.filter((path) => path.endsWith('/ticker')).length, 2);
});

test('invalid ticker values are not returned as valid quotes', async () => {
  for (const last of ['NaN', 'Infinity', '0', '-1']) {
    const service = await loadService(async () => ({ ok: true, json: async () => ({ code: '0', data: [{ last }] }) }));
    assert.equal(await service.getCryptoQuoteData('BTC'), null);
  }
});

test('cold snapshots start indicators while the initial ticker is still pending', async () => {
  const paths = [];
  let resolveTicker;
  const ticker = new Promise(resolve => { resolveTicker = resolve; });
  const service = await loadService(async url => {
    const path = new URL(url).pathname;
    paths.push(path);
    if (path.endsWith('/ticker')) return ticker;
    return { ok: true, json: async () => ({ code: '0', data: [] }) };
  });
  const pending = service.getCryptoMarketData('BTC');
  assert.ok(paths.some(path => path.endsWith('/candles')));
  assert.ok(paths.some(path => path.endsWith('/funding-rate')));
  assert.ok(paths.some(path => path.endsWith('/books')));
  resolveTicker({ ok: true, json: async () => ({ code: '0', data: [{ last: '100' }] }) });
  assert.equal((await pending).price, 100);
});

test('the quote API does not wait for a full snapshot', async () => {
  const source = await readFile(new URL('../../../app/api/crypto/market/route.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, URL, console, require(name) {
    if (name === 'next/server') return { NextResponse: { json: (data, options) => Response.json(data, options) } };
    return {
      extractCryptoSymbolFromText: analysis.extractCryptoSymbolFromText,
      getCryptoQuoteData: async symbol => { assert.equal(symbol, 'BTC'); return { symbol, price: 100 }; },
      getCryptoMarketData: () => assert.fail('quote requests must not fetch full analysis'),
    };
  } });
  const response = await exports.GET(new Request('http://localhost/api/crypto/market?symbol=BTC&mode=quote'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.price, 100);
});

test('shared market tools expose facts and preserve missing indicator values as null', async () => {
  const source = await readFile(new URL('./market-tools.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require: name => name.includes('okx-analysis') ? analysis : ({
    normalizeSymbol: analysis.normalizeSymbol,
    getCryptoQuoteData: async () => ({ symbol: 'BTC', price: 100 }),
    getCryptoMarketData: async () => ({ symbol: 'BTC', price: 100, dataQuality: {}, microstructure: {} }),
  }) });
  const snapshot = await exports.queryCryptoMarket('crypto_market_snapshot', { symbol: 'BTC' });
  assert.equal(snapshot.fundingRate, null);
  assert.equal(snapshot.oiUsd, null);
  assert.equal(snapshot.oiDelta1hWindow, null);
  assert.equal(snapshot.priceDelta1hPercent, null);
  assert.equal(snapshot.microstructure.depthImbalance, null);
  assert.match(snapshot.candleConfirmationGuidance, /盘中穿越关键位只能描述为突破\/跌破尝试/);
  assert.equal('analysis' in snapshot, false);
  assert.equal('positions' in snapshot, false);
  await assert.rejects(exports.queryCryptoMarket('trade', { symbol: 'BTC' }));
  await assert.rejects(exports.queryCryptoMarket('crypto_quote', { symbol: '../BTC' }));
});

async function oiHarness() {
  let now = Date.parse('2026-11-15T04:05:00Z');
  const clock = class extends Date { static now() { return now; } };
  let payload = { code: '0', data: [] };
  let requests = 0;
  const service = await loadService(async rawUrl => {
    const url = new URL(rawUrl);
    if (url.pathname.endsWith('/open-interest-history')) {
      requests++;
      assert.equal(url.searchParams.get('instId'), 'BTC-USDT-SWAP');
      assert.equal(url.searchParams.get('period'), '1H');
      return { ok: true, json: async () => payload };
    }
    return { ok: true, json: async () => ({ code: '0', data: url.pathname.endsWith('/ticker') ? [{ last: '101' }] : [] }) };
  }, clock);
  return { read: () => service.getCryptoMarketData('BTC'), reply: value => { payload = value; },
    advance: () => { now += 120_000; }, requests: () => requests };
}

const oiRow = (time, value) => [String(Date.parse(time)), String(value), '0'];

test('OI uses actual hourly endpoints and instrument scope across cache refreshes, even when percentages repeat', async () => {
  const h = await oiHarness();
  const rows = [oiRow('2026-11-15T02:00:00Z', 100), oiRow('2026-11-15T03:00:00Z', 110)];
  h.reply({ code: '0', data: rows }); // deliberately oldest first
  const first = await h.read();
  assert.equal(first.oiDelta1hPercent, 10);
  assert.equal(first.dataQuality.oiDelta1h, true);
  assert.equal(JSON.stringify(first.oiDelta1hWindow), JSON.stringify({ from: '2026-11-15T02:00:00.000Z', to: '2026-11-15T03:00:00.000Z', period: '1H', scope: 'OKX_INSTRUMENT_CONTRACTS', instId: 'BTC-USDT-SWAP', metric: 'CONTRACTS', ccy: 'BTC' }));
  await h.read();
  assert.equal(h.requests(), 1, 'short cache reuses the statistical window');
  h.advance();
  const same = await h.read();
  assert.notEqual(same.derivativesFetchedAt, first.derivativesFetchedAt);
  assert.equal(JSON.stringify(same.oiDelta1hWindow), JSON.stringify(first.oiDelta1hWindow), 'new collection time is not a new statistics window');
  h.reply({ code: '0', data: [oiRow('2026-11-15T04:00:00Z', 121), ...rows] });
  h.advance();
  const next = await h.read();
  assert.equal(next.oiDelta1hPercent, first.oiDelta1hPercent);
  assert.equal(next.oiDelta1hWindow.from, '2026-11-15T03:00:00.000Z');
  assert.equal(next.oiDelta1hWindow.to, '2026-11-15T04:00:00.000Z');
  const prompt = analysis.formatCryptoContextForPrompt(next);
  assert.match(prompt, /范围为 OKX BTC-USDT-SWAP，按持仓张数计算/);
  assert.match(prompt, /衍生层采集时间不是OI统计时间/);
});

test('invalid, future, gapped and rejected OI samples cannot become an hourly confirmation', async () => {
  const h = await oiHarness();
  for (const payload of [
    { code: '0', data: [oiRow('2026-11-15T04:00:00Z', 110), oiRow('2026-11-15T02:00:00Z', 100)] },
    { code: '0', data: [oiRow('2026-11-15T03:00:00Z', 110), oiRow('2026-11-15T02:00:00Z', 0)] },
    { code: '0', data: [oiRow('2026-11-15T06:00:00Z', 110), oiRow('2026-11-15T05:00:00Z', 100)] },
    { code: '0', data: [null, ['bad', '100'], oiRow('2026-11-15T03:00:00Z', Infinity)] },
    { code: '500', data: [oiRow('2026-11-15T03:00:00Z', 110), oiRow('2026-11-15T02:00:00Z', 100)] },
  ]) {
    h.reply(payload); h.advance();
    const result = await h.read();
    assert.equal(result.dataQuality.oiDelta1h, false);
    assert.equal(result.oiDelta1hWindow, null);
  }
});

 test('OI delta ignores USD valuation changes when contract positions are unchanged', async () => {
  const h = await oiHarness();
  h.reply({ code: '0', data: [
    [String(Date.parse('2026-11-15T03:00:00Z')), '100', '1', '110000'],
    [String(Date.parse('2026-11-15T02:00:00Z')), '100', '1', '100000'],
  ] });
  const snapshot = await h.read();
  assert.equal(snapshot.dataQuality.oiDelta1h, true);
  assert.equal(snapshot.oiDelta1hPercent, 0);
  assert.equal(snapshot.oiDelta1hWindow.metric, 'CONTRACTS');
});
