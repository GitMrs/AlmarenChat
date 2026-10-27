import test from 'node:test';
import assert from 'node:assert/strict';
import { activeGrowthEvents, validateCognition } from './cognition.mjs';
const old = { id: 'old', type: 'BELIEF', scope: 'PERSONAL', spaceId: null, payload: { beliefKey: '时间' } };
test('revision hides old judgment only in its own scope and preserves history', () => {
  const revision = { id: 'new', type: 'REVISION', scope: 'SPACE', spaceId: 'a', payload: { supersedesEventId: 'old' } };
  assert.equal(activeGrowthEvents([old, revision]).length, 2);
  assert.deepEqual(activeGrowthEvents([old, { ...revision, scope: 'PERSONAL', spaceId: null }]).map(e => e.id), ['new']);
});
test('cognition requires owned evidence and matching active judgment', () => {
  const input = { type: 'REVISION', title: '修正', content: '按时间判断', beliefKey: '时间', behaviorChange: '先确认时间', evidenceRefs: [{ type: 'experience', id: 'experience' }], supersedesEventId: 'old' };
  assert.equal(validateCognition(input, [old], ['experience']).supersedesEventId, 'old');
  assert.throws(() => validateCognition(input, [old], ['other']));
  assert.throws(() => validateCognition({ ...input, beliefKey: '其他' }, [old], ['experience']));
  assert.throws(() => validateCognition(input, [], ['experience']));
});
