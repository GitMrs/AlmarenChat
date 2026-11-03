import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createTrendingSchedule, getNextTrendingRun } from './schedule.mjs';

const quietLogger = { log() {}, warn() {} };

async function fixture(t, initial = '2026-11-04T07:59:00+08:00') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'almaren-trending-schedule-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let current = Date.parse(initial);
  const timers = new Set();
  const schedules = [];
  const calls = [];
  const now = () => new Date(current);
  const create = (run = async () => { calls.push(now().toISOString()); return { success: true }; }) => {
    const schedule = createTrendingSchedule({
      run, directory, now, logger: quietLogger,
      setTimer(callback, delay) {
        const timer = { callback, at: current + delay, unref() {} };
        timers.add(timer);
        return timer;
      },
      clearTimer: timer => timers.delete(timer),
    });
    schedules.push(schedule);
    return schedule;
  };
  t.after(() => schedules.forEach(schedule => schedule.stop()));
  return {
    directory, calls, create, timers,
    setTime: time => { current = Date.parse(time); },
    next: () => [...timers].sort((a, b) => a.at - b.at)[0],
    async fire(timer = [...timers][0], delay = 0) {
      timers.delete(timer);
      current = timer.at + delay;
      await timer.callback();
    },
    read: (date, slot) => readFile(path.join(directory, date, `${slot}.json`), 'utf8').then(JSON.parse),
  };
}

test('next run uses Beijing time and selects only the two future daily slots', () => {
  const cases = [
    ['2026-11-03T23:59:00Z', '2026-11-04:08:00', '2026-11-04T00:00:00.000Z'],
    ['2026-11-04T00:00:00Z', '2026-11-04:23:42', '2026-11-04T15:42:00.000Z'],
    ['2026-11-04T15:41:59Z', '2026-11-04:23:42', '2026-11-04T15:42:00.000Z'],
    ['2026-11-04T15:42:00Z', '2026-11-05:08:00', '2026-11-05T00:00:00.000Z'],
    ['2026-12-31T16:30:00Z', '2027-01-01:08:00', '2027-01-01T00:00:00.000Z'],
  ];
  for (const [input, id, scheduledAt] of cases) {
    const next = getNextTrendingRun(new Date(input));
    assert.equal(next.id, id);
    assert.equal(next.scheduledAt, scheduledAt);
  }
});

test('starting without any archive never fetches; two daily runs are recorded on disk', async t => {
  const f = await fixture(t);
  const schedule = f.create();
  schedule.start();
  schedule.start();
  assert.equal(f.timers.size, 1);
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.read('2026-11-04', '0800'), { code: 'ENOENT' });
  await f.fire(f.next());
  assert.equal(f.calls.length, 1);
  const morning = await f.read('2026-11-04', '0800');
  assert.equal(morning.status, 'COMPLETED');
  assert.equal(morning.startedAt, '2026-11-04T00:00:00.000Z');
  assert.equal(f.next().at, Date.parse('2026-11-04T23:42:00+08:00'));
  await f.fire(f.next());
  assert.equal(f.calls.length, 2);
  assert.equal((await f.read('2026-11-04', '2342')).status, 'COMPLETED');
  assert.equal(f.next().at, Date.parse('2026-11-05T08:00:00+08:00'));
});

test('restarting after a missed morning slot waits for the evening without catch-up', async t => {
  const f = await fixture(t, '2026-11-04T10:00:00+08:00');
  const first = f.create();
  first.start();
  assert.equal(f.calls.length, 0);
  first.stop();
  f.setTime('2026-11-04T15:00:00+08:00');
  f.create().start();
  assert.equal(f.calls.length, 0);
  assert.equal(f.timers.size, 1);
  assert.equal(f.next().at, Date.parse('2026-11-04T23:42:00+08:00'));
});

test('overlapping PM2 schedulers claim the same slot only once', async t => {
  const f = await fixture(t);
  f.create().start();
  f.create().start();
  const timers = [...f.timers];
  await Promise.all(timers.map(timer => f.fire(timer)));
  assert.equal(f.calls.length, 1);
  assert.equal((await f.read('2026-11-04', '0800')).status, 'COMPLETED');
});

test('a persisted running claim prevents re-execution after an interrupted process', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.directory, '2026-11-04'));
  await writeFile(path.join(f.directory, '2026-11-04', '0800.json'), JSON.stringify({ status: 'RUNNING' }));
  f.create().start();
  await f.fire(f.next());
  assert.equal(f.calls.length, 0);
  assert.equal((await f.read('2026-11-04', '0800')).status, 'RUNNING');
  assert.equal(f.next().at, Date.parse('2026-11-04T23:42:00+08:00'));
});

test('failed runs persist their outcome and wait for the next slot', async t => {
  const f = await fixture(t);
  f.create(async () => { throw Error('fixture failure'); }).start();
  await f.fire(f.next());
  const record = await f.read('2026-11-04', '0800');
  assert.equal(record.status, 'FAILED');
  assert.equal(record.error, 'fixture failure');
  assert.equal(f.next().at, Date.parse('2026-11-04T23:42:00+08:00'));
});

test('a suspended timer skips missed slots instead of running late', async t => {
  const f = await fixture(t);
  f.create().start();
  await f.fire(f.next(), 2 * 60 * 1000);
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.read('2026-11-04', '0800'), { code: 'ENOENT' });
  assert.equal(f.next().at, Date.parse('2026-11-04T23:42:00+08:00'));
});

test('stopping cancels pending work, including already queued callbacks', async t => {
  const f = await fixture(t);
  const schedule = f.create();
  schedule.start();
  const pending = f.next();
  schedule.stop();
  assert.equal(f.timers.size, 0);
  await f.fire(pending);
  assert.equal(f.calls.length, 0);
  assert.equal(f.timers.size, 0);
});

test('application startup only registers the schedule and both slots force the AI summary', async () => {
  const source = await readFile(new URL('./scheduler.ts', import.meta.url), 'utf8');
  let scheduled;
  let starts = 0;
  let fetches = 0;
  const summaries = [];
  let failSources = false;
  const mocks = {
    './service': {
      getAvailableSources: () => { if (failSources) throw Error('fixture source error'); return [{ id: 'fixture' }]; },
      getTrendingSnapshot: async () => { fetches++; },
    },
    './summary-service': { getOrGenerateTrendingSummary: async options => { summaries.push(options); return { sampleCount: 1 }; } },
    './storage': { getLocalISODate: () => '2026-11-04' },
    './schedule.mjs': { createTrendingSchedule: options => {
      scheduled = options;
      return { start: () => { starts++; }, stop() {} };
    } },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    exports, console: quietLogger, process: { env: { NODE_ENV: 'production' } },
    setTimeout: callback => { callback(); },
    require: name => { if (name in mocks) return mocks[name]; throw Error(name); },
  });
  exports.startTrendingScheduler();
  exports.startTrendingScheduler();
  assert.equal(starts, 1);
  assert.equal(fetches, 0);
  for (let slot = 0; slot < 2; slot++) assert.equal((await scheduled.run()).success, true);
  assert.equal(fetches, 2);
  assert.equal(summaries.length, 2);
  assert.ok(summaries.every(options => options.forceRefresh && options.date === 'today' && options.category === 'all'));
  failSources = true;
  await assert.rejects(scheduled.run(), /fixture source error/);
  failSources = false;
  assert.equal((await scheduled.run()).success, true, 'an unexpected failure must release the sync lock');
  exports.stopTrendingScheduler();
});
