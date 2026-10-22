import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as market from './event-market.ts';
import { buildEventRadarContext } from './event-temporal.ts';

const at = Date.parse('2026-10-01T12:30:00Z');
const event = { id: 'cpi', title: 'CPI测试', category: 'macro', timestamp: new Date(at).toISOString(),
  impactCoins: ['ALL'], volatilityTier: 3 };
const later = at + 2 * 86400_000;
const sourceUrl = 'https://www.okx.com/api/v5/market/history-candles?instId=BTC-USDT-SWAP&bar=1m';
const makeResult = (window) => ({
  status: 'complete', baselineAt: new Date(at - 60_000).toISOString(), baselineClose: 100,
  windowStart: event.timestamp, windowEnd: new Date(at + market.EVENT_MARKET_WINDOWS[window] * 60_000).toISOString(),
  close: 100, high: 101, low: 99, returnPct: 0, highPct: (101 / 100 - 1) * 100, lowPct: (99 / 100 - 1) * 100,
  candleCount: market.EVENT_MARKET_WINDOWS[window], collectedAt: new Date(later).toISOString(), sourceUrls: [sourceUrl],
});
const tracked = (stages) => ({ ...event, marketObservation: {
  provider: 'okx', instrument: 'BTC-USDT-SWAP', scheduledAt: event.timestamp, stages,
} });

async function loadModule(file, dependencies, clock = later) {
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, console, URL, URLSearchParams, Date: ClockDate, Error,
    require(name) { if (name === './event-market.ts') return market; if (dependencies[name]) return dependencies[name]; throw Error(name); },
  });
  return exports;
}

const candles = (count) => Array.from({ length: count + 1 }, (_, index) => {
  const close = index === 0 ? 100 : 100 + index;
  return [String(at + (index - 1) * 60_000), String(close), String(index === 0 ? 999 : close + 1),
    String(index === 0 ? 1 : close - 1), String(close), '1', '1', '1', '1'];
}).reverse();

async function sourceFor(rows, clock = later, transform = value => value) {
  const urls = [];
  const api = await loadModule('./event-market-source.ts', { '../../web/proxy.ts': { smartFetch: async url => {
    urls.push(url);
    const cursor = Number(new URL(url).searchParams.get('after'));
    const data = rows.filter(row => Number(row[0]) < cursor).slice(0, 300);
    return { ok: true, json: async () => transform({ code: '0', data }) };
  } } }, clock);
  return { ...api, urls };
}

test('uses the last pre-event close and exact closed windows, excluding baseline extrema', async () => {
  const source = await sourceFor(candles(6)); // 最后一根位于区间外，不可计入。
  const result = await source.fetchEventMarketWindow(event.timestamp, '5m');
  assert.equal(result.baselineClose, 100);
  assert.equal(result.close, 105);
  assert.equal(result.high, 106);
  assert.equal(result.low, 100);
  assert.equal(result.candleCount, 5);
  assert.ok(Math.abs(result.returnPct - 5) < 1e-8);
  assert.ok(Math.abs(result.highPct - 6) < 1e-8);
  assert.equal(result.lowPct, 0);
  assert.equal(source.urls.length, 1);
  assert.equal(result.sourceUrls[0], source.urls[0]);
  assert.ok(market.getEventMarketResult(tracked({ '5m': result }), '5m', new Date(later)));
});

test('paginates all 1440 minutes plus baseline and records every source page', async () => {
  const source = await sourceFor(candles(1440));
  const result = await source.fetchEventMarketWindow(event.timestamp, '24h');
  assert.equal(source.urls.length, 5);
  assert.equal(result.candleCount, 1440);
  assert.equal(result.close, 1540);
  assert.equal(result.sourceUrls.length, 5);
  assert.equal(result.windowEnd, new Date(at + 86400_000).toISOString());
});

test('does not request data before a window closes or for a non-minute schedule', async () => {
  const source = await sourceFor(candles(5), at + 5 * 60_000 - 1);
  await assert.rejects(source.fetchEventMarketWindow(event.timestamp, '5m'), /尚未结束/);
  await assert.rejects(source.fetchEventMarketWindow(new Date(at + 1).toISOString(), '5m'), /不是整分钟/);
  assert.equal(source.urls.length, 0);
  const boundary = await sourceFor(candles(5), at + 5 * 60_000);
  assert.equal((await boundary.fetchEventMarketWindow(event.timestamp, '5m')).status, 'complete');
});

test('missing minutes, unclosed candles, malformed OHLC and API failures stay unavailable', async () => {
  for (const mutate of [
    rows => rows.filter(row => Number(row[0]) !== at + 60_000),
    rows => rows.map((row, i) => i === 0 ? [...row.slice(0, 8), '0'] : row),
    rows => rows.map((row, i) => i === 0 ? [row[0], 'NaN', ...row.slice(2)] : row),
    rows => rows.map((row, i) => i === 0 ? [row[0], row[1], '1', ...row.slice(3)] : row),
  ]) {
    const source = await sourceFor(mutate(candles(5)));
    await assert.rejects(source.fetchEventMarketWindow(event.timestamp, '5m'));
  }
  const codeError = await sourceFor(candles(5), later, body => ({ ...body, code: '50011' }));
  await assert.rejects(codeError.fetchEventMarketWindow(event.timestamp, '5m'), /暂无/);
  const httpError = await loadModule('./event-market-source.ts', { '../../web/proxy.ts': {
    smartFetch: async () => ({ ok: false, status: 429 }),
  } });
  await assert.rejects(httpError.fetchEventMarketWindow(event.timestamp, '5m'), /429/);
});

test('duplicate candles cannot mask gaps or conflicting values', async () => {
  const rows = candles(5);
  const duplicates = await sourceFor([...rows, rows[1]]);
  assert.equal((await duplicates.fetchEventMarketWindow(event.timestamp, '5m')).candleCount, 5);
  const conflict = [...rows[1]];
  conflict[4] = String(Number(conflict[4]) + 0.1);
  const source = await sourceFor([...rows, conflict]);
  await assert.rejects(source.fetchEventMarketWindow(event.timestamp, '5m'), /冲突/);
});

test('complete tracking requires valid evidence and consistent event time and baseline', () => {
  const stages = Object.fromEntries(Object.keys(market.EVENT_MARKET_WINDOWS).map(window => [window, makeResult(window)]));
  const complete = tracked(stages);
  assert.equal(market.hasCompleteEventMarket(complete, new Date(later)), true);
  assert.equal(market.hasCompleteEventMarket(tracked({ '5m': stages['5m'] }), new Date(later)), false);
  for (const invalid of [
    { ...complete, timestamp: new Date(at + 60_000).toISOString() }, { ...complete, simulated: true },
    tracked({ ...stages, '5m': { ...stages['5m'], returnPct: 999 } }),
    tracked({ ...stages, '5m': { ...stages['5m'], sourceUrls: [] } }),
    tracked({ ...stages, '5m': { ...stages['5m'], collectedAt: 'invalid' } }),
    tracked({ ...stages, '5m': { ...stages['5m'], candleCount: 4 } }),
  ]) assert.equal(market.hasCompleteEventMarket(invalid, new Date(later)), false);
  assert.equal(market.hasCompleteEventMarket(complete, new Date(at + 3600_000)), false);
});

test('Agent only sees completed price observations with provenance, never partial stages or invented macro conclusions', () => {
  const active = { ...event, id: 'active', timestamp: new Date(later + 30 * 60_000).toISOString() };
  const options = { now: new Date(later), activeSymbols: ['BTC'] };
  const partial = buildEventRadarContext({ ...options, events: [tracked({ '5m': makeResult('5m') }), active] });
  assert.doesNotMatch(partial, /历史事件前后 BTC 行情观察/);
  const stages = Object.fromEntries(Object.keys(market.EVENT_MARKET_WINDOWS).map(window => [window, makeResult(window)]));
  const full = buildEventRadarContext({ ...options, events: [tracked(stages), active] });
  assert.match(full, /历史事件前后 BTC 行情观察/);
  assert.match(full, /期末涨跌 \+0.00%/);
  assert.match(full, /www.okx.com/);
  assert.match(full, /不代表实际公布值、预期差或事件导致涨跌/);
  assert.doesNotMatch(full, /V_REVERSAL|主力洗盘|符合预期|宏观偏向判定/);
});

async function collectorFor(initial, clock = later) {
  let events = structuredClone(initial);
  let fail = false;
  let release;
  let hold = false;
  const calls = [];
  const api = await loadModule('./event-market-collector.ts', {
    './event-sync.ts': {
      readCryptoEventsFromDisk: async () => structuredClone(events),
      persistEventMarketStage: async (id, scheduledAt, window, stage) => {
        const target = events.find(item => item.id === id);
        target.marketObservation ??= { provider: 'okx', instrument: 'BTC-USDT-SWAP', scheduledAt, stages: {} };
        target.marketObservation.stages[window] = stage;
        return true;
      },
    },
    './event-market-source.ts': { fetchEventMarketWindow: async (scheduledAt, window) => {
      calls.push({ scheduledAt, window });
      if (hold) await new Promise(resolve => { release = resolve; });
      if (fail) throw new Error('OKX 暂不可用');
      return makeResult(window);
    } },
  }, clock);
  return { ...api, calls, get events() { return events; }, setFail: value => { fail = value; },
    hold: () => { hold = true; }, release: () => release() };
}

test('collector skips future events and unrelated/simulated events without requesting any market data', async () => {
  const collector = await collectorFor([
    { ...event, timestamp: new Date(later).toISOString() }, { ...event, category: 'unlock' },
    { ...event, simulated: true }, { ...event, impactCoins: ['ETH'] },
  ]);
  assert.equal((await collector.collectNextEventMarketWindow()).status, 'idle');
  assert.equal(collector.calls.length, 0);
});

test('collector backfills one stage per tick, skips completed data, and survives a restart', async () => {
  const collector = await collectorFor([event]);
  for (const window of ['5m', '1h', '24h']) {
    const result = await collector.collectNextEventMarketWindow();
    assert.equal(result.status, 'complete');
    assert.equal(result.window, window);
  }
  assert.equal((await collector.collectNextEventMarketWindow()).status, 'idle');
  assert.equal(collector.calls.length, 3);
  const restarted = await collectorFor(collector.events);
  assert.equal((await restarted.collectNextEventMarketWindow()).status, 'idle');
  assert.equal(restarted.calls.length, 0);
});

test('collector records retry cooldown without fabricating zeros and retries after cooldown', async () => {
  const collector = await collectorFor([event]);
  collector.setFail(true);
  assert.equal((await collector.collectNextEventMarketWindow()).status, 'retry');
  const stage = collector.events[0].marketObservation.stages['5m'];
  assert.equal(stage.status, 'retry');
  assert.equal(stage.returnPct, undefined);
  assert.equal(Date.parse(stage.retryAt), later + 5 * 60_000);
  const duringCooldown = await collectorFor(collector.events, later + 60_000);
  assert.equal((await duringCooldown.collectNextEventMarketWindow()).window, '1h');
  const afterCooldown = await collectorFor(collector.events, later + 5 * 60_000);
  assert.equal((await afterCooldown.collectNextEventMarketWindow()).window, '5m');
});

test('concurrent scheduler/manual calls cannot create overlapping collection requests', async () => {
  const collector = await collectorFor([event]);
  collector.hold();
  const first = collector.collectNextEventMarketWindow();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await collector.collectNextEventMarketWindow(event.id)).status, 'busy');
  collector.release();
  await first;
  assert.equal(collector.calls.length, 1);
});
