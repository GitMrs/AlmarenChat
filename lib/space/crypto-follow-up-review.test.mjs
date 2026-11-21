import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCryptoAssessment, candidateRiskCheck, verifyCandidateConfirmation, formatCryptoAssessment } from './crypto-follow-up-review-policy.mjs';
import { reviewCryptoCandidate } from './crypto-follow-up-review.ts';

const now = Date.parse('2026-11-21T12:30:00Z');
const hour = Date.parse('2026-11-21T11:00:00Z');
const candidate = { symbol: 'BTC', direction: 'LONG', entryMin: 100, entryMax: 102, stopLoss: 95,
  takeProfit1: 120, takeProfit2: 125, invalidationPrice: 96, tp1Fraction: 0.5,
  confirmation: { period: '1H', breakoutStartMs: hour, retestStartMs: hour + 3600000, level: 100 } };
const assessment = normalizeCryptoAssessment({ status: 'CANDIDATE', reason: 'Original level confirmed', candidate });
const snapshot = { symbol: 'BTC', price: 102, realtimeFetchedAt: new Date(now).toISOString(),
  dataQuality: { ticker: true, candles1h: true, candles15m: true },
  candles1h: [{ startTimeMs: hour - 3600000, close: 99, isClosed: true }, { startTimeMs: hour, close: 101, isClosed: true }],
  candles15m: [{ startTimeMs: hour + 3600000, high: 103, low: 100.1, close: 101.5, isClosed: true }] };
const execute = (review, overrides = {}) => reviewCryptoCandidate({ assessment, snapshot, analystId: 'crypto-chart-master', now, review, ...overrides });

test('candidate assessment validates geometry, targets and required confirmation evidence', () => {
  for (const c of [{ ...candidate, stopLoss: 110 }, { ...candidate, takeProfit2: 110 }, { ...candidate, tp1Fraction: 2 }, { ...candidate, confirmation: null }]) {
    assert.throws(() => normalizeCryptoAssessment({ status: 'CANDIDATE', reason: 'Evidence', candidate: c }));
  }
  assert.deepEqual(normalizeCryptoAssessment({ status: 'WAITING', reason: 'Not yet' }), { status: 'WAITING', reason: 'Not yet' });
});

test('simultaneously closing hourly and 15m candles do not prove a subsequent retest', async () => {
  const same = { ...candidate, confirmation: { ...candidate.confirmation, retestStartMs: hour + 2700000 } };
  const market = { ...snapshot, candles15m: [{ ...snapshot.candles15m[0], startTimeMs: hour + 2700000 }] };
  const result = await execute(() => assert.fail('must not call reviewers without confirmation'), {
    assessment: { ...assessment, candidate: same }, snapshot: market,
  });
  assert.equal(result.status, 'CONFIRMATION_FAILED');
  assert.match(result.reason, /同时收盘/);
});

test('open, stale, missing and invalidated evidence cannot become an approved candidate', () => {
  for (const market of [
    { ...snapshot, realtimeFetchedAt: new Date(now - 200000).toISOString() },
    { ...snapshot, candles15m: [{ ...snapshot.candles15m[0], isClosed: false }] },
    { ...snapshot, dataQuality: { ticker: true } },
    { ...snapshot, candles1h: snapshot.candles1h.slice(1) },
    { ...snapshot, price: 95 }, { ...snapshot, price: 121 },
  ]) assert.equal(verifyCandidateConfirmation(candidate, market, now).ok, false);
});

test('confirmed candidates invoke whale then risk exactly once and expose their independent verdicts', async () => {
  const calls = [];
  const result = await execute(async (id, c, risk, prior) => {
    calls.push(id);
    assert.equal(c.confirmation.level, 100);
    assert.equal(risk.roundTripCostBps, 20);
    assert.equal(prior.length, calls.length - 1);
    return { agentName: id, verdict: 'PASS', reason: 'Evidence checked' };
  });
  assert.deepEqual(calls, ['crypto-whale-hunter', 'crypto-risk-warden']);
  assert.equal(result.status, 'APPROVED_FOR_WATCH');
  assert.equal(result.risk.sizing, 'NEEDS_CURRENT_ACCOUNT_EQUITY');
  assert.match(formatCryptoAssessment(result), /待用户确认观察计划/);
});

test('whale rejection and risk rejection are terminal decisions rather than new waiting targets', async () => {
  for (const rejected of ['crypto-whale-hunter', 'crypto-risk-warden']) {
    const result = await execute(async id => ({ verdict: id === rejected ? 'REJECT' : 'PASS', reason: 'Concrete reason' }));
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.reviews.length, 2);
  }
});

test('missing members, model errors and missing verdicts are blocked outcomes, never fabricated approvals', async () => {
  const failed = await execute(async () => { throw new Error('Member unavailable'); });
  assert.equal(failed.status, 'REVIEW_BLOCKED');
  assert.equal(failed.reviews.length, 0);
  const partial = await execute(async id => id === 'crypto-risk-warden' ? { verdict: 'PASS', reason: '' } : { verdict: 'PASS', reason: 'Checked' });
  assert.equal(partial.status, 'REVIEW_BLOCKED');
  assert.equal(partial.reviews.length, 1);
});

test('program risk veto survives model PASS and includes worst entry, partial targets and assumed costs', async () => {
  const lowReward = { ...candidate, takeProfit1: 108, takeProfit2: 110 };
  assert.equal(candidateRiskCheck(lowReward).passed, false);
  const result = await execute(async () => ({ verdict: 'PASS', reason: 'Model approved' }), { assessment: { ...assessment, candidate: lowReward } });
  assert.equal(result.status, 'REJECTED');
  assert.match(result.reason, /不足1:2/);
  assert.equal(result.risk.maxAccountRiskFraction, 0.02);
});

test('an observing task does not start the heavy review workflow', async () => {
  const result = await execute(() => assert.fail('no candidate'), { assessment: { status: 'WAITING', reason: 'Original condition not met' } });
  assert.equal(result.status, 'WAITING');
});

test('candidates cannot raise the saved level or replace hourly confirmation with 15m', async () => {
  for (const referenceConditions of [
    [{ symbol: 'BTC', direction: 'ABOVE', period: 'PRICE', level: 98 }],
    [{ symbol: 'BTC', direction: 'ABOVE', period: '15m', level: 100 }],
  ]) {
    const result = await execute(() => assert.fail('changed condition must not reach review'), { referenceConditions });
    assert.equal(result.status, 'CONFIRMATION_FAILED');
    assert.match(result.reason, /原条件不一致/);
  }
});
