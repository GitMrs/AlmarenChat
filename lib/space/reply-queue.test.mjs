import assert from 'node:assert/strict';
import test from 'node:test';
import { replyQueueProgress } from './reply-queue.mjs';

test('a single reply followed by two handoffs keeps the first speaker and counts a returning speaker once', () => {
  const requests = [{ target: { id: 'chart' } }];
  requests.push({ target: { id: 'risk' } });
  assert.deepEqual(replyQueueProgress(requests, 1, 'host'), {
    agentIds: ['chart', 'risk'], index: 1, memberCount: 2,
  });
  requests.push({ target: { id: 'chart' } });
  assert.deepEqual(replyQueueProgress(requests, 2, 'host'), {
    agentIds: ['chart', 'risk', 'chart'], index: 2, memberCount: 2,
  });
});

test('the actual speaker replaces the initial default when the server routes the message', () => {
  const requests = [{ target: null, speakerAgentId: 'chart' }, { target: { id: 'risk' } }];
  assert.deepEqual(replyQueueProgress(requests, 0, 'host'), {
    agentIds: ['chart', 'risk'], index: 0, memberCount: 2,
  });
});

test('the coordinator opening and closing a discussion counts once', () => {
  const requests = [null, { id: 'chart' }, { id: 'risk' }, { id: 'host' }].map(target => ({ target }));
  assert.deepEqual(replyQueueProgress(requests, 3, 'host'), {
    agentIds: ['host', 'chart', 'risk', 'host'], index: 3, memberCount: 3,
  });
});
