import assert from 'node:assert/strict';
import test from 'node:test';
import { latestRunInRetryChain } from './agent-run-retry-chain.mjs';

test('chat run links follow cancelled retries to the latest attempt', () => {
  const runs = [
    { id: 'attempt-3', retryOfId: 'attempt-2', status: 'WAITING_APPROVAL', createdAt: '2026-08-16T03:00:00Z' },
    { id: 'attempt-2', retryOfId: 'attempt-1', status: 'CANCELLED', createdAt: '2026-08-16T02:00:00Z' },
    { id: 'attempt-1', retryOfId: null, status: 'BLOCKED', createdAt: '2026-08-16T01:00:00Z' },
    { id: 'other', retryOfId: null, status: 'COMPLETED', createdAt: '2026-08-16T04:00:00Z' },
  ];
  assert.equal(latestRunInRetryChain(runs, 'attempt-1')?.id, 'attempt-3');
  assert.equal(latestRunInRetryChain(runs, 'other')?.id, 'other');
  assert.equal(latestRunInRetryChain(runs, 'missing'), null);
});
