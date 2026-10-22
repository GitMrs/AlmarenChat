import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatDataTools } from './chat-data-tools.mjs';
import { createAutoWebTools, runAutoWebChat } from '../web/auto-web-core.mjs';

const weatherData = { location: { city: '杭州', name: '西湖' }, kind: 'now', updateTime: '2026-10-16T10:00:00+08:00', link: 'https://www.qweather.com/weather/hangzhou.html', observations: { obsTime: '2026-10-16T09:50:00+08:00', temp: '20' } };
const marketData = { source: 'OKX', symbol: 'BTC', instId: 'BTC-USDT-SWAP', price: 100_000, fetchedAt: '2026-10-16T02:00:00.000Z', dataQuality: { fundingRate: false }, fundingRate: null };
const snapshot = (source, updatedAt = '2026-10-15T01:00:00.000Z') => ({ source, sourceName: source, updatedAt, items: [{ title: '榜单话题', url: `https://example.com/${source}`, desc: '摘要' }] });

function setup(overrides = {}) {
  const calls = [];
  const dataTools = createChatDataTools({ weather: { query: async (args) => { calls.push(['weather', args]); return weatherData; } }, trending: async (source) => { calls.push(['trending', source]); return snapshot(source); }, crypto: async (name, args) => { calls.push([name, args]); return marketData; }, trendingSources: ['zhihu', 'weibo', 'baidu'], ...overrides });
  const web = createAutoWebTools({ dataTools, search: async () => { calls.push(['search']); return { sources: [{ title: '新闻', url: 'https://example.com/news' }] }; } });
  return { calls, web };
}

test('default weather location is used only for unspecified or matching locations', async () => {
  const saved = { id: '101210101', name: '杭州' };
  for (const location of ['', '杭州', saved.id]) {
    const { calls, web } = setup({ defaultWeatherLocation: saved });
    const result = await web.execute('weather_query', { location, kind: 'daily', date: '2026-10-17' });
    assert.notEqual(result.status, 'waiting');
    assert.equal(calls[0][1].location, saved.id);
    assert.equal(calls[0][1].resolvedLocation.id, saved.id);
    assert.equal(calls[0][1].kind, 'daily');
    assert.equal(calls[0][1].date, '2026-10-17');
  }
  const { calls, web } = setup({ defaultWeatherLocation: saved });
  await web.execute('weather_query', { location: '北京' });
  assert.equal(calls[0][1].location, '北京');
  assert.equal(calls[0][1].resolvedLocation, undefined);
});

test('other-city candidate confirmation is not replaced by the account default', async () => {
  const { calls, web } = setup({ defaultWeatherLocation: { id: '101210101', name: '杭州' }, pendingWeather: { candidates: [{ id: '101010300', name: '朝阳' }] } });
  assert.equal((await web.execute('weather_query', {})).status, 'waiting');
  assert.equal(calls.length, 0);
  await web.execute('weather_query', { location: '101010300' });
  assert.equal(calls[0][1].location, '101010300');
  assert.equal(calls[0][1].resolvedLocation, undefined);
});

test('invalid or cleared defaults still require a location', async () => {
  for (const value of [null, {}, { id: 123, name: '杭州' }, { id: 'bad/code', name: '杭州' }]) {
    const { calls, web } = setup({ defaultWeatherLocation: value });
    assert.equal((await web.execute('weather_query', {})).status, 'waiting');
    assert.equal(calls.length, 0);
  }
});

test('registering specialized tools never eagerly calls any provider', () => {
  const { calls, web } = setup();
  assert.deepEqual(calls, []);
  assert.deepEqual(web.tools.map((tool) => tool.function.name), ['web_search', 'web_fetch', 'weather_query', 'trending_query', 'crypto_quote', 'crypto_market_snapshot']);
  assert.deepEqual(web.attachments(), []);
});

test('missing and ambiguous weather locations ask for input without successful sources', async () => {
  const { calls, web } = setup({ weather: { query: async () => ({ needsLocation: true, candidateLocations: [{ id: '1', name: '朝阳', city: '北京' }, { id: '2', name: '朝阳', province: '辽宁' }] }) } });
  const missing = await web.execute('weather_query', { kind: 'daily', date: '2026-10-17' });
  assert.equal(missing.status, 'waiting');
  assert.equal(missing.ok, false);
  assert.deepEqual(calls, []);
  assert.equal(web.footer(), '');
  const ambiguous = await web.execute('weather_query', { location: '朝阳', kind: 'daily', date: '2026-10-17' });
  assert.equal(ambiguous.status, 'waiting');
  assert.equal(ambiguous.candidates.length, 2);
  const pending = web.attachments().find((attachment) => attachment.type === 'weather_query_v1');
  assert.deepEqual(pending.query, { kind: 'daily', date: '2026-10-17' });
  assert.equal(pending.candidates.length, 2);
  assert.equal(web.footer(), '');
});

test('weather preserves actual data times and clears a resolved location prompt', async () => {
  const { calls, web } = setup();
  await web.execute('weather_query', { kind: 'now' });
  const result = await web.execute('weather_query', { location: '杭州', kind: 'now' });
  assert.equal(result.ok, true);
  assert.equal(result.data.observations.obsTime, weatherData.observations.obsTime);
  assert.equal(calls.length, 1);
  assert.match(web.footer(), /和风天气[\s\S]*2026-10-16T10:00:00\+08:00/);
  assert.match(web.footer(), /可能使用缓存/);
  assert.equal(web.attachments().some((attachment) => attachment.type === 'weather_query_v1'), false);
});

test('specialized tools and search share the same budget and cache', async () => {
  const { calls, web } = setup();
  await web.execute('weather_query', { location: '杭州', kind: 'now' });
  await web.execute('weather_query', { kind: 'now', location: '杭州' });
  await web.execute('trending_query', { source: 'zhihu' });
  await web.execute('crypto_quote', { symbol: 'BTC' });
  const refused = await web.execute('web_search', { query: 'BTC新闻' });
  assert.equal(refused.ok, false);
  assert.equal(calls.length, 3);
  assert.equal(web.attachments()[0].records.length, 3);
});

test('aggregated trending retains each platform timestamp and reports partial results', async () => {
  const { web } = setup({ trending: async (source) => {
    if (source === 'baidu') throw new Error('upstream failed');
    return snapshot(source, source === 'zhihu' ? '2026-10-14T01:00:00.000Z' : '2026-10-15T01:00:00.000Z');
  } });
  const result = await web.execute('trending_query', { source: 'all' });
  assert.equal(result.partial, true);
  assert.equal(result.data.length, 2);
  assert.match(web.footer(), /2026-10-14T01:00:00.000Z/);
  assert.match(web.footer(), /2026-10-15T01:00:00.000Z/);
  assert.match(web.footer(), /部分平台未返回数据/);
  assert.doesNotMatch(web.footer(), /example.com\/baidu/);
});

test('empty or invalid trending queries never claim successful retrieval', async () => {
  let requests = 0;
  const { web } = setup({ trending: async () => { requests += 1; return { items: [] }; } });
  assert.equal((await web.execute('trending_query', { source: 'arbitrary-url' })).ok, false);
  assert.equal(requests, 0);
  assert.equal((await web.execute('trending_query', { source: 'zhihu' })).status, 'empty');
  assert.doesNotMatch(web.footer(), /\*\*查询来源/);
});

test('crypto tools preserve quote/snapshot choice, missing fields and market identity', async () => {
  const { calls, web } = setup();
  assert.equal((await web.execute('crypto_quote', {})).status, 'waiting');
  assert.equal(calls.length, 0);
  const quote = await web.execute('crypto_quote', { symbol: 'btc' });
  const analysis = await web.execute('crypto_market_snapshot', { symbol: 'BTC' });
  assert.deepEqual(calls.map((call) => call[0]), ['crypto_quote', 'crypto_market_snapshot']);
  assert.equal(quote.data.fundingRate, null);
  assert.equal(analysis.data.dataQuality.fundingRate, false);
  assert.match(web.footer(), /BTC-USDT-SWAP.*USDT 永续合约/);
  assert.match(web.footer(), /2026-10-16T02:00:00.000Z/);
});

test('failed crypto quotes produce no invented OKX source', async () => {
  const { web } = setup({ crypto: async () => null });
  assert.equal((await web.execute('crypto_quote', { symbol: 'BTC' })).ok, false);
  assert.match(web.footer(), /查询失败/);
  assert.doesNotMatch(web.footer(), /www.okx.com/);
});

test('the model can select a specialized quote without invoking generic search', async () => {
  const { calls, web } = setup();
  let requests = 0;
  const client = { chat: { completions: { create: async function* () {
    requests += 1;
    if (requests === 1) yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'quote1', type: 'function', function: { name: 'crypto_quote', arguments: '{"symbol":"BTC"}' } }] } }] };
    else yield { choices: [{ delta: { content: '这是 OKX 的永续合约报价。' } }] };
  } } } };
  const answer = await runAutoWebChat({ client, model: 'test', messages: [{ role: 'user', content: 'BTC多少钱' }], web });
  assert.deepEqual(calls.map((call) => call[0]), ['crypto_quote']);
  assert.match(answer, /查询来源[\s\S]*www.okx.com/);
});
