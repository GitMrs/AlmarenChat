import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveAgentGrowthState, formatAgentGrowthState } from './state.mjs';

const event = (type, days, payload = {}) => ({
  type,
  payload,
  createdAt: new Date(Date.UTC(2026, 0, 1 + days)).toISOString(),
});

test('growth state is derived from append-only events', () => {
  const state = deriveAgentGrowthState([
    event('STUDY', 0, { title: '初次学习' }),
    event('BELIEF', 1, { title: '形成判断', content: '我开始理解这件事' }),
    event('REVISION', 2, { title: '修正判断', content: '后来发现需要重新思考' }),
    event('REFLECTION', 3, { title: '回顾', content: '我记住了这次变化' }),
  ], Date.UTC(2026, 0, 4));

  assert.equal(state.stage, 4);
  assert.equal(state.stageName, '持续整合');
  assert.equal(state.days, 4);
  assert.equal(state.eventCount, 4);
  assert.equal(state.counts.BELIEF, 1);
  assert.equal(state.recentRevisions[0].title, '修正判断');
  assert.match(formatAgentGrowthState(state), /判断 1 次/);
});

test('empty growth history has no context', () => {
  const state = deriveAgentGrowthState([]);
  assert.equal(state.stage, 1);
  assert.equal(state.eventCount, 0);
  assert.equal(formatAgentGrowthState(state), '');
});
