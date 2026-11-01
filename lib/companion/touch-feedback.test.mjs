import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleTouchFeedback } from './touch-feedback.mjs';

test('touch recoil responds immediately, is bounded and settles without changing a motion clock', () => {
  for (const region of ['head', 'face', 'body']) {
    const start = sampleTouchFeedback(0, region, 100, 1);
    assert.ok(Math.abs(start.ParamAngleZ) > 0);
    for (let i = 0; i < 60; i++) {
      for (const value of Object.values(sampleTouchFeedback(i / 100, region, 100, 1))) assert.ok(Number.isFinite(value) && Math.abs(value) <= 4.2);
    }
    assert.ok(Math.abs(sampleTouchFeedback(0.59, region).ParamAngleZ) < 0.02);
    assert.equal(sampleTouchFeedback(0.6, region), null);
  }
});

test('touch recoil mirrors direction and rejects invalid timing', () => {
  assert.equal(sampleTouchFeedback(0, 'face', 1, -1).ParamAngleZ, -sampleTouchFeedback(0, 'face', 1, 1).ParamAngleZ);
  assert.equal(sampleTouchFeedback(-1, 'head'), null);
  assert.equal(sampleTouchFeedback(NaN, 'head'), null);
});

