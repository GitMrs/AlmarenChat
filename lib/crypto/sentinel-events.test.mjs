import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as temporal from './event-temporal.ts';

async function runObservation(snapshot, minutes = 20) {
  const clock = Date.parse('2026-10-23T14:00:00Z') + minutes * 60_000;
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const writes = [];
  const event = { id: 'isolated', title: 'CPI', category: 'macro',
    timestamp: '2026-10-23T14:00:00Z', impactCoins: ['ALL'], volatilityTier: 3, forecast: '2.0%' };
  const source = await readFile(new URL('./sentinel-service.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports, console, Date: ClockDate, globalThis: {}, process: { env: {} },
    require(name) {
      if (name === '@/app/api/_lib/db') return { default: {
        space: { findUnique: async () => ({ id: 'isolated', templateSnapshot: {} }), update: async () => ({}) },
        spaceMessage: { create: async () => ({}) },
      } };
      if (name === './okx-service') return { getCryptoMarketData: async () => snapshot };
      if (name === './event-market-collector.ts') return { collectNextEventMarketWindow: () => assert.fail('must not collect during room checks') };
      if (name === 'node:crypto') return { randomUUID: () => 'isolated-test' };
      if (name === '../runtime/scheduler.mjs') return { createScheduler: () => assert.fail('must not start scheduler') };
      if (name === './trade-lifecycle') return { isPlanExpired: () => false };
      if (name === './event-temporal.ts') return temporal;
      if (name === './event-sync.ts') return {
        readCryptoEventsFromDisk: async () => [event],
        persistEventImpact: async (...args) => { writes.push(args); return true; },
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  const result = await exports.checkSentinelForSpace('isolated');
  return { result, writes };
}

const snapshot = {
  price: 100.8, priceDelta15mPercent: 0.8,
  realtimeFetchedAt: '2026-10-23T14:20:00Z',
  dataQuality: { ticker: true, candles15m: true },
  candles15m: [{ startTimeMs: Date.parse('2026-10-23T14:15:00Z'), open: 100 }],
};

test('early observation never persists fabricated macro or final market conclusions', async () => {
  const { result, writes } = await runObservation(snapshot);
  assert.equal(writes.length, 0);
  assert.equal(result.alerts.length, 1);
  assert.match(result.alerts[0].title, /早期观察/);
  assert.match(result.alerts[0].content, /20 分钟/);
  assert.match(result.alerts[0].content, /当前15分钟K线.*\+0.80%/);
  assert.match(result.alerts[0].content, /实际公布值.*未核验/);
  assert.doesNotMatch(result.alerts[0].content, /V_REVERSAL|PUMP|CHOPPY|符合预期|插针基本释放完毕/);
});

test('failed or stale quotes do not become zero volatility or a market direction', async () => {
  for (const missing of [null, { ...snapshot, realtimeFetchedAt: '2026-10-23T14:00:00Z' },
    { ...snapshot, dataQuality: { ticker: false, candles15m: false } }]) {
    const { result, writes } = await runObservation(missing);
    assert.equal(writes.length, 0);
    assert.match(result.alerts[0].content, /行情暂不可用/);
    assert.doesNotMatch(result.alerts[0].content, /0\.00%|震荡|\$100/);
  }
});

test('a valid zero candle move is reported, while missing or old candles stay unknown', async () => {
  const zero = await runObservation({ ...snapshot, price: 100 });
  assert.match(zero.result.alerts[0].content, /\+0.00%/);
  for (const candles15m of [[], [{ startTimeMs: Date.parse('2026-10-23T13:45:00Z'), open: 100 }]]) {
    const { result } = await runObservation({ ...snapshot, candles15m });
    assert.match(result.alerts[0].content, /现价/);
    assert.match(result.alerts[0].content, /K线涨跌未知/);
    assert.doesNotMatch(result.alerts[0].content, /\+0.80%/);
  }
});

test('later observations use actual elapsed time instead of always saying 15 minutes', async () => {
  const { result } = await runObservation({ ...snapshot, realtimeFetchedAt: '2026-10-23T14:40:00Z', candles15m: [] }, 40);
  assert.match(result.alerts[0].content, /40 分钟/);
  assert.doesNotMatch(result.alerts[0].content, /发布已过去 15 分钟|落地 15 分钟/);
});

test('pre-event alerts still run without creating a review', async () => {
  const { result, writes } = await runObservation(null, -20);
  assert.equal(writes.length, 0);
  assert.match(result.alerts[0].title, /决战倒计时.*20 分钟/);
  assert.equal(result.alerts[0].level, 'CRITICAL');
});

test('market collection uses the existing scheduler and runs independently of empty rooms', async () => {
  const tasks = new Map();
  let schedulerCreations = 0;
  let starts = 0;
  let collections = 0;
  const source = await readFile(new URL('./sentinel-service.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports, console: { log() {}, warn() {} }, Date, globalThis: {}, process: { env: { NODE_ENV: 'production' } },
    require(name) {
      if (name === '@/app/api/_lib/db') return { default: { space: { findMany: async () => [] } } };
      if (name === './okx-service') return { getCryptoMarketData: () => assert.fail('no room needs realtime quotes') };
      if (name === './event-market-collector.ts') return { collectNextEventMarketWindow: async () => { collections++; } };
      if (name === 'node:crypto') return { randomUUID: () => 'test' };
      if (name === '../runtime/scheduler.mjs') return { createScheduler: (options) => {
        schedulerCreations++;
        assert.equal(options.pollMs, 30_000);
        return { register: (name, handler) => tasks.set(name, handler), start: () => starts++ };
      } };
      if (name === './trade-lifecycle') return { isPlanExpired: () => false };
      if (name === './event-temporal.ts') return temporal;
      if (name === './event-sync.ts') return { readCryptoEventsFromDisk: async () => [] };
      throw new Error(name);
    },
  });
  exports.startCryptoSentinelScheduler();
  exports.startCryptoSentinelScheduler();
  assert.equal(schedulerCreations, 1);
  assert.equal(starts, 1);
  assert.equal(tasks.size, 3);
  await tasks.get('check-spaces')();
  assert.equal(collections, 0);
  await tasks.get('collect-event-market')();
  assert.equal(collections, 1);
});
