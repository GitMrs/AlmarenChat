import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import Database from 'better-sqlite3';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../../src/generated/prisma/client.ts';
import * as watch from './follow-up-watch.mjs';
import { normalizeFollowUp, normalizeFollowUpContinuation } from './follow-up-policy.mjs';

const at = Date.parse('2026-11-21T06:30:00Z');
const rule = { symbol: 'BTC', period: 'PRICE', direction: 'ABOVE', level: 56499 };
const quote = (price, now = at) => ({ symbol: 'BTC', price, realtimeFetchedAt: new Date(now).toISOString(), dataQuality: { ticker: true } });

test('watch registration validates rules, enforces authorization and leaves legacy timers unchanged', () => {
  const input = { title: 'BTC', prompt: 'Check price', runAt: new Date(at + 3600000).toISOString() };
  assert.deepEqual(normalizeFollowUp(input, at), { ...input, runAt: new Date(input.runAt) });
  assert.equal(normalizeFollowUp({ ...input, watchConditions: [rule] }, at).watchConditions[0].level, 56499);
  for (const rules of [[{ ...rule, level: Infinity }], [{ ...rule, period: '5m' }], [rule, rule], Array(7).fill(rule)]) {
    assert.throws(() => watch.normalizeFollowUpWatches(rules));
  }
  const next = { ...input, reason: 'Wait for candle', watchConditions: [rule] };
  assert.throws(() => normalizeFollowUpContinuation({ id: 'a', runAt: new Date(at), domain: 'GENERAL' }, next, at));
  assert.equal(normalizeFollowUpContinuation({ id: 'a', runAt: new Date(at), domain: 'CRYPTO', networkAllowed: true }, next, at).watchConditions.length, 1);
});

test('price crossing is an early warning; arming above a level never claims a new crossing', () => {
  const armed = watch.evaluateFollowUpWatches([rule], {}, { BTC: quote(56134) }, at);
  assert.equal(armed.event, null);
  const crossing = watch.evaluateFollowUpWatches([rule], armed.state, { BTC: quote(56500, at + 30000) }, at + 30000);
  assert.equal(crossing.event.level, 56499);
  assert.equal(watch.evaluateFollowUpWatches([rule], crossing.state, { BTC: quote(58000, at + 60000) }, at + 60000).event, null);
  const alreadyAbove = watch.evaluateFollowUpWatches([rule], {}, { BTC: quote(58000) }, at);
  assert.equal(alreadyAbove.event, null);
  assert.equal(watch.evaluateFollowUpWatches([rule], alreadyAbove.state, { BTC: quote(58900, at + 30000) }, at + 30000).event, null);
});

test('failed, stale, future or wrong-symbol quotes cannot wake follow-ups', () => {
  const armed = watch.evaluateFollowUpWatches([rule], {}, { BTC: quote(56000) }, at);
  for (const snapshot of [null, quote(58000, at - 100000), quote(58000, at + 100000),
    { ...quote(58000), dataQuality: { ticker: false } }, { ...quote(58000), symbol: 'ETH' }]) {
    assert.equal(watch.evaluateFollowUpWatches([rule], armed.state, { BTC: snapshot }, at + 30000).event, null);
  }
});

test('close watches ignore open candles and repeated samples, and support downside crossings', () => {
  const closeRule = { ...rule, period: '15m', direction: 'BELOW' };
  const snapshot = (close, closed, start) => ({ symbol: 'BTC', dataQuality: { candles15m: true },
    candles15m: [{ startTimeMs: start, close, isClosed: closed }] });
  const armed = watch.evaluateFollowUpWatches([closeRule], {}, { BTC: snapshot(57000, true, at - 900000) }, at);
  assert.equal(watch.evaluateFollowUpWatches([closeRule], armed.state, { BTC: snapshot(56000, false, at) }, at + 900000).event, null);
  assert.equal(watch.evaluateFollowUpWatches([closeRule], armed.state, { BTC: snapshot(56000, true, at) }, at + 900000).event.period, '15m');
  assert.equal(watch.evaluateFollowUpWatches([closeRule], armed.state, { BTC: snapshot(56000, true, at - 900000) }, at + 1000).event, null);
});

test('persistent eagle watches wake the same task once, survive restart and respect user switches', async t => {
  const root = new URL('../../', import.meta.url);
  const folder = await mkdtemp(path.join(tmpdir(), 'almaren-watch-'));
  const file = path.join(folder, 'test.db');
  const raw = new Database(file);
  const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) });
  const exports = {};
  const source = await readFile(new URL('./follow-up-watch-service.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Date, Set, JSON, Promise, require: () => watch });
  const tick = exports.checkFollowUpWatches;
  try {
    for (const name of (await readdir(new URL('prisma/migrations/', root))).filter(n => /^\d/.test(n)).sort()) {
      raw.exec(await readFile(new URL(`prisma/migrations/${name}/migration.sql`, root), 'utf8'));
    }
    await db.user.create({ data: { id: 'owner', email: 'watch@test.local', name: 'owner', passwordHash: 'fixture' } });
    await db.space.create({ data: { id: 'space', userId: 'owner', name: 'space', templateId: 'crypto-contract-trading', followUpEnabled: true,
      members: { create: { agentId: 'crypto-chart-master', sortOrder: 0 } } } });
    const create = async (id, extra = {}) => db.spaceFollowUp.create({ data: { id, spaceId: 'space', agentId: 'crypto-chart-master',
      sourceKey: id, domain: 'CRYPTO', networkAllowed: true, title: 'Watch BTC', prompt: 'Review only', context: '',
      runAt: new Date(at + 4500000), nextAttemptAt: new Date(at + 4500000), watchConditions: [rule], ...extra } });
    await t.test('crossing 56499 wakes the 15:45 task before 58000, without an extra chain item', async () => {
      await create('first');
      await tick({ db, now: new Date(at), getMarket: async () => quote(56134) });
      const outcomes = await Promise.all([1, 2].map(() => tick({ db, now: new Date(at + 30000), getMarket: async () => quote(56500, at + 30000) })));
      assert.equal(outcomes.reduce((n, r) => n + r.triggered, 0), 1);
      const task = await db.spaceFollowUp.findUnique({ where: { id: 'first' } });
      assert.ok(task.nextAttemptAt.getTime() >= at + 30000 && task.nextAttemptAt.getTime() < at + 90000);
      assert.equal(task.runAt.getTime(), at + 4500000);
      assert.equal(task.watchEvent.level, 56499);
      assert.equal(task.chainDepth, 0);
      assert.equal(await db.spaceFollowUp.count(), 1);
      assert.equal((await tick({ db, now: new Date(at + 60000), getMarket: async () => { assert.fail('already triggered'); } })).triggered, 0);
      await db.spaceFollowUp.update({ where: { id: 'first' }, data: { status: 'COMPLETED' } });
    });
    await t.test('cooldown persists across polls; running tasks are never accelerated again', async () => {
      await create('second');
      await tick({ db, now: new Date(at + 60000), getMarket: async () => quote(56000, at + 60000) });
      assert.equal((await tick({ db, now: new Date(at + 90000), getMarket: async () => quote(56500, at + 90000) })).triggered, 0);
      assert.equal((await tick({ db, now: new Date(at + 360000), getMarket: async () => quote(56500, at + 360000) })).triggered, 1);
      await db.spaceFollowUp.update({ where: { id: 'second' }, data: { status: 'RUNNING' } });
      await tick({ db, now: new Date(at + 390000), getMarket: async () => assert.fail('running') });
      await db.spaceFollowUp.update({ where: { id: 'second' }, data: { status: 'COMPLETED' } });
    });
    await t.test('cancellation or turning eagle off while quotes load suppresses the wake-up', async () => {
      await create('cancel');
      await tick({ db, now: new Date(at), getMarket: async () => quote(56000) });
      await tick({ db, now: new Date(at + 1000000), getMarket: async () => {
        await db.spaceFollowUp.update({ where: { id: 'cancel' }, data: { status: 'CANCELLED' } });
        return quote(58000, at + 1000000);
      } });
      assert.equal((await db.spaceFollowUp.findUnique({ where: { id: 'cancel' } })).watchEvent, null);
      await create('disabled');
      await tick({ db, now: new Date(at), getMarket: async () => quote(56000) });
      await tick({ db, now: new Date(at + 1000000), getMarket: async () => {
        await db.space.update({ where: { id: 'space' }, data: { templateSnapshot: { sentinelState: { serverSentinelEnabled: false } } } });
        return quote(58000, at + 1000000);
      } });
      assert.equal((await db.spaceFollowUp.findUnique({ where: { id: 'disabled' } })).watchEvent, null);
      await tick({ db, now: new Date(at + 1100000), getMarket: async () => assert.fail('eagle disabled') });
    });
  } finally { await db.$disconnect(); raw.close(); await rm(folder, { recursive: true, force: true }); }
});
