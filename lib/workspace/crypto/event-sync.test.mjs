import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as market from './event-market.ts';

// 文件和网络均隔离，回归测试绝不改写项目的真实日历。
async function loadSync(initial = []) {
  let disk = JSON.stringify(initial);
  let pendingDisk;
  let cache = [];
  let response = { ok: true, json: async () => [] };
  const source = await readFile(new URL('./event-sync.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source.replaceAll('import.meta.url', "'file:///C:/calendar/event-sync.ts'"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports, console, Date, URL, process,
    require: (name) => {
      if (name === 'node:fs/promises') return {
        readFile: async () => disk,
        writeFile: async (_path, content) => { pendingDisk = content; },
        rename: async () => { disk = pendingDisk; },
      };
      if (name === 'node:path') return { default: path };
      if (name === './event-market.ts') return market;
      if (name === './event-temporal.ts') return {
        loadGlobalCryptoEvents: () => cache,
        reloadGlobalCryptoEvents: (events) => { cache = events; },
      };
      if (name === '../../web/proxy.ts') return { smartFetch: async () => response };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return {
    ...exports,
    disk: () => JSON.parse(disk),
    replaceDisk: (value) => { disk = typeof value === 'string' ? value : JSON.stringify(value); },
    setResponse: (value) => { response = value; },
  };
}

const raw = (title, date = '2026-10-23T10:00:00-04:00', extra = {}) => ({
  title, date, country: 'USD', impact: 'Medium', forecast: ' 46.3 ', previous: '46.0', ...extra,
});

test('distinguishes preliminary/revised, core/headline and FOMC event variants', async () => {
  const sync = await loadSync();
  const titles = [
    ['Prelim UoM Consumer Sentiment', '消费者信心初值'],
    ['Revised UoM Consumer Sentiment', '消费者信心修正值'],
    ['Revised UoM Inflation Expectations', '通胀预期修正值'],
    ['Retail Sales m/m', '美国零售销售'],
    ['Core Retail Sales m/m', '美国核心零售销售'],
    ['PCE Price Index m/m', '美国PCE'],
    ['Core PCE Price Index m/m', '美国核心PCE'],
    ['FOMC Meeting Minutes', '会议纪要'],
    ['FOMC Press Conference', '新闻发布会'],
    ['Federal Funds Rate', '利率决议'],
    ['Advance GDP q/q', '初值'],
    ['Final GDP q/q', '终值'],
    ['Advance GDP Price Index q/q', '美国GDP价格指数初值'],
    ['Core CPI m/m', '美国核心CPI'],
    ['Core PPI m/m', '美国核心PPI'],
  ];
  for (const [title, expected] of titles) {
    const [event] = sync.transformToCryptoEvents([raw(title)]);
    assert.ok(event, title);
    assert.ok(event.title.includes(expected), `${title}: ${event.title}`);
    assert.ok(event.title.includes(title), 'preserves upstream title');
    assert.equal(event.source.title, title);
  }
  assert.ok(!sync.transformToCryptoEvents([raw('Retail Sales m/m')])[0].title.includes('核心'));
  assert.ok(!sync.transformToCryptoEvents([raw('PCE Price Index m/m')])[0].title.includes('核心'));
});

test('preserves source rating, missing forecast and offset-aware summer/winter times', async () => {
  const sync = await loadSync();
  const [weekly, monthly, winter] = sync.transformToCryptoEvents([
    raw('ADP Weekly Employment Change', '2026-10-20T08:15:00-04:00', { impact: 'Low', forecast: '' }),
    raw('ADP Non-Farm Employment Change', undefined, { impact: 'High' }),
    raw('CPI m/m', '2026-11-12T08:30:00-05:00'),
  ]);
  assert.equal(weekly.timestamp, '2026-10-20T12:15:00.000Z');
  assert.equal(winter.timestamp, '2026-11-12T13:30:00.000Z');
  assert.equal(weekly.volatilityTier, 1);
  assert.equal(monthly.volatilityTier, 3);
  assert.equal(weekly.source.impact, 'Low');
  assert.equal(weekly.source.calendarWeek, '2026-10-18');
  assert.equal(weekly.forecast, null);
  assert.equal(monthly.forecast, '46.3');
  assert.ok(Number.isFinite(Date.parse(weekly.source.fetchedAt)));
  assert.equal(sync.transformToCryptoEvents([raw('CPI m/m', undefined, { country: 'GBP' })]).length, 0);
  assert.throws(() => sync.transformToCryptoEvents([raw('CPI m/m', 'invalid')]), /时间/);
});

test('snapshot reconciles rescheduled events without merging other weeks, manual entries or reviews', async () => {
  const sync = await loadSync();
  const make = (date) => sync.transformToCryptoEvents([raw('Unemployment Claims', date)])[0];
  const old = make('2099-10-20T08:30:00-04:00');
  const next = make('2099-10-22T08:30:00-04:00');
  const otherWeek = make('2099-10-27T08:30:00-04:00');
  const manual = { ...old, id: 'manual-claims', source: undefined };
  const reviewed = { ...old, id: 'reviewed', impact: { playbookTakeaway: 'keep' } };
  sync.replaceDisk([old, otherWeek, manual, reviewed]);
  await sync.mergeEventsIntoJson([next], [next.source.calendarWeek]);
  assert.deepEqual(sync.disk().map((e) => e.id).sort(), [next.id, otherWeek.id, manual.id, reviewed.id].sort());
  await sync.mergeEventsIntoJson([{ ...next, forecast: 'new' }], [next.source.calendarWeek]);
  assert.equal(sync.disk().filter((e) => e.id === next.id).length, 1);
  // 同周不同统计期仍在最新快照时，不能被误合并。
  await sync.mergeEventsIntoJson([old, next], [next.source.calendarWeek]);
  assert.ok(sync.disk().some((e) => e.id === old.id));
});

test('migrates legacy Revised/Final alias and preserves the existing impact', async () => {
  const sync = await loadSync();
  const [event] = sync.transformToCryptoEvents([raw('Revised UoM Consumer Sentiment')]);
  const impact = { playbookTakeaway: 'existing review' };
  sync.replaceDisk([{ ...event, id: event.id.replace('revised-', 'final-'), source: undefined, impact }]);
  await sync.mergeEventsIntoJson([event]);
  assert.equal(sync.disk().length, 1);
  assert.equal(sync.disk()[0].id, event.id);
  assert.deepEqual(sync.disk()[0].impact, impact);
});

test('market stage writes merge with concurrent calendar/review updates and reject rescheduled results', async () => {
  const sync = await loadSync();
  const [event] = sync.transformToCryptoEvents([raw('CPI m/m')]);
  const stage = { status: 'retry', attemptedAt: '2026-10-24T00:00:00Z', retryAt: '2026-10-24T00:05:00Z', error: 'missing candles' };
  const review = { marketReaction: {}, playbookTakeaway: 'keep separate' };
  sync.replaceDisk([event]);
  await Promise.all([
    sync.persistEventMarketStage(event.id, event.timestamp, '5m', stage),
    sync.persistEventMarketStage(event.id, event.timestamp, '1h', stage),
    sync.mergeEventsIntoJson([{ ...event, forecast: 'updated' }]),
    sync.persistEventImpact(event.id, review),
  ]);
  const saved = sync.disk()[0];
  assert.equal(saved.forecast, 'updated');
  assert.deepEqual(saved.impact, review);
  assert.deepEqual(saved.marketObservation.stages, { '5m': stage, '1h': stage });
  await sync.mergeEventsIntoJson([{ ...event, timestamp: '2026-10-23T14:30:00Z' }]);
  assert.equal(sync.disk()[0].marketObservation, undefined);
  assert.equal(await sync.persistEventMarketStage(event.id, event.timestamp, '24h', stage), false);
  assert.equal(sync.disk()[0].marketObservation, undefined);
  assert.deepEqual(sync.disk()[0].impact, review);
});

test('a completed market stage is preserved when a late failed request returns', async () => {
  const sync = await loadSync();
  const [event] = sync.transformToCryptoEvents([raw('CPI m/m')]);
  const start = Date.parse(event.timestamp);
  const stage = {
    status: 'complete', baselineAt: new Date(start - 60_000).toISOString(), baselineClose: 100,
    windowStart: event.timestamp, windowEnd: new Date(start + 5 * 60_000).toISOString(),
    close: 100, high: 100, low: 100, returnPct: 0, highPct: 0, lowPct: 0,
    candleCount: 5, collectedAt: new Date(start + 5 * 60_000).toISOString(),
    sourceUrls: ['https://www.okx.com/api/v5/market/history-candles?instId=BTC-USDT-SWAP&bar=1m'],
  };
  // 使用已过去的日历时刻，不依赖测试运行日是否晚于上面的未来样本。
  event.timestamp = '2020-01-01T00:00:00.000Z';
  stage.baselineAt = '2019-12-31T23:59:00.000Z';
  stage.windowStart = event.timestamp;
  stage.windowEnd = stage.collectedAt = '2020-01-01T00:05:00.000Z';
  sync.replaceDisk([event]);
  await sync.persistEventMarketStage(event.id, event.timestamp, '5m', stage);
  await sync.persistEventMarketStage(event.id, event.timestamp, '5m', { status: 'retry', error: 'late failure' });
  assert.deepEqual(sync.disk()[0].marketObservation.stages['5m'], stage);
});

test('reads external disk updates and persists reviews against the latest data', async () => {
  const sync = await loadSync();
  const [event] = sync.transformToCryptoEvents([raw('CPI m/m')]);
  sync.replaceDisk([event]);
  assert.equal((await sync.readCryptoEventsFromDisk()).length, 1);
  const extra = { ...event, id: 'external-new-event' };
  sync.replaceDisk([event, extra]);
  const impact = { playbookTakeaway: 'test review' };
  assert.equal(await sync.persistEventImpact(event.id, impact), true);
  assert.equal(sync.disk().length, 2);
  assert.deepEqual(sync.disk()[0].impact, impact);
});

test('invalid stored JSON aborts merge instead of silently destroying existing data', async () => {
  const sync = await loadSync();
  sync.replaceDisk('{broken');
  await assert.rejects(sync.mergeEventsIntoJson([]));
  await assert.rejects(sync.readCryptoEventsFromDisk());
});

test('upstream throttling fails visibly and cannot masquerade as a fresh sync', async () => {
  const sync = await loadSync();
  sync.setResponse({ ok: true, json: async () => [raw('CPI m/m')] });
  await sync.fetchLiveForexFactoryCalendar(true);
  sync.setResponse({ ok: false, status: 429, statusText: 'Too Many Requests' });
  await assert.rejects(sync.fetchLiveForexFactoryCalendar(true), /429/);
});

test('empty or malformed upstream snapshots preserve the existing calendar', async () => {
  const initial = [{ id: 'manual', title: 'keep' }];
  const sync = await loadSync(initial);
  for (const response of [[], [raw('CPI m/m', 'invalid')], [null]]) {
    sync.setResponse({ ok: true, json: async () => response });
    await assert.rejects(sync.syncMacroEvents());
    assert.deepEqual(sync.disk(), initial);
  }
});

test('synchronization and review writes do not overwrite each other in the same process', async () => {
  const sync = await loadSync();
  const [event] = sync.transformToCryptoEvents([raw('CPI m/m')]);
  sync.replaceDisk([event]);
  const impact = { playbookTakeaway: 'keep concurrent review' };
  await Promise.all([
    sync.persistEventImpact(event.id, impact),
    sync.mergeEventsIntoJson([{ ...event, forecast: 'updated' }]),
  ]);
  assert.equal(sync.disk()[0].forecast, 'updated');
  assert.deepEqual(sync.disk()[0].impact, impact);
});
