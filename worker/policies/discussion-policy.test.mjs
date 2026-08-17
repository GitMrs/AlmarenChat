import assert from 'node:assert/strict';
import test from 'node:test';
import { discussionSequence, nextDiscussionPosition } from './discussion-policy.mjs';

test('discussion uses forward first round and reverse second round', () => {
  const participants = ['product', 'ui', 'frontend'];
  assert.deepEqual(discussionSequence(participants, 1), ['product', 'ui', 'frontend']);
  assert.deepEqual(discussionSequence(participants, 2), ['frontend', 'ui', 'product']);
  assert.deepEqual(participants, ['product', 'ui', 'frontend']);
});

test('discussion advances to summary immediately after the second round', () => {
  let position = { round: 1, index: 0 };
  for (let turn = 0; turn < 6; turn += 1) {
    position = nextDiscussionPosition(position.round, position.index, 3);
  }
  assert.deepEqual(position, { round: 3, index: 0 });
});
