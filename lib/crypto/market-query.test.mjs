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

async function loadService(fetcher) {
  const source = await readFile(new URL('./okx-service.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, console, Date, Map, Promise,
    require: (name) => name.includes('proxy') ? { smartFetch: fetcher } : analysis,
  });
  return exports;
}

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

test('shared market tools expose facts and preserve missing indicator values as null', async () => {
  const source = await readFile(new URL('./market-tools.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require: () => ({
    normalizeSymbol: analysis.normalizeSymbol,
    getCryptoQuoteData: async () => ({ symbol: 'BTC', price: 100 }),
    getCryptoMarketData: async () => ({ symbol: 'BTC', price: 100, dataQuality: {}, microstructure: {} }),
  }) });
  const snapshot = await exports.queryCryptoMarket('crypto_market_snapshot', { symbol: 'BTC' });
  assert.equal(snapshot.fundingRate, null);
  assert.equal(snapshot.oiUsd, null);
  assert.equal(snapshot.priceDelta1hPercent, null);
  assert.equal(snapshot.microstructure.depthImbalance, null);
  assert.equal('analysis' in snapshot, false);
  assert.equal('positions' in snapshot, false);
  await assert.rejects(exports.queryCryptoMarket('trade', { symbol: 'BTC' }));
  await assert.rejects(exports.queryCryptoMarket('crypto_quote', { symbol: '../BTC' }));
});
