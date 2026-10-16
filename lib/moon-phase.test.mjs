import assert from 'node:assert/strict';
import test from 'node:test';
import { moonPhase } from './moon-phase.mjs';

const reference = Date.UTC(2000, 0, 6, 18, 14);
const cycle = 29.530588853 * 86_400_000;

test('new, quarter and full moons have the expected illuminated area and orientation', () => {
  const fresh = moonPhase(reference);
  assert.equal(fresh.name, '新月');
  assert.equal(fresh.illumination, 0);
  assert.equal(fresh.path, '');
  const first = moonPhase(reference + cycle / 4);
  assert.equal(first.name, '上弦月');
  assert.ok(Math.abs(first.illumination - 0.5) < 1e-8);
  assert.match(first.path, /A 17 17 0 0 1 0 17 L 0 -17/);
  const full = moonPhase(reference + cycle / 2);
  assert.equal(full.name, '满月');
  assert.ok(full.illumination > 0.999999);
  const last = moonPhase(reference + cycle * 3 / 4);
  assert.equal(last.name, '下弦月');
  assert.match(last.path, /A 17 17 0 0 0 0 17 L 0 -17/);
});

test('dates before the reference and repeated lunar cycles remain normalized', () => {
  for (const offset of [-100, -1, 0, 1, 100, 330]) {
    const result = moonPhase(reference + cycle * (offset + 0.125));
    assert.ok(result.phase >= 0 && result.phase < 1);
    assert.equal(result.name, '娥眉月');
    assert.ok(Math.abs(result.illumination - (1 - Math.SQRT1_2) / 2) < 1e-8);
    assert.doesNotMatch(result.path, /NaN|Infinity/);
  }
  assert.throws(() => moonPhase(NaN), /日期无效/);
});

test('known recent moon dates agree with the approximate lunar cycle', () => {
  assert.ok(moonPhase(Date.UTC(2024, 3, 8, 18, 21)).illumination < 0.01);
  assert.ok(moonPhase(Date.UTC(2024, 2, 25, 7)).illumination > 0.99);
});
