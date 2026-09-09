import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeSpaceOperations } from './space-operations.mjs';

test('space operations summarizes lifecycle, automation and publication outcomes', () => {
  const summary = summarizeSpaceOperations({
    works: [
      { status: 'ACTIVE', stage: 'review' },
      { status: 'COMPLETED', stage: 'ready' },
    ],
    runs: [{ status: 'COMPLETED' }, { status: 'FAILED_VALIDATION' }],
    automationExecutions: [{ status: 'COMPLETED' }, { status: 'FAILED' }, { status: 'TRIGGERED' }],
    actions: [
      { kind: 'WECHAT_CREATE_DRAFT', status: 'COMPLETED' },
      { kind: 'WECHAT_PUBLISH', status: 'COMPLETED' },
      { kind: 'WECHAT_PUBLISH', status: 'FAILED' },
      { kind: 'WECHAT_CREATE_DRAFT', status: 'PENDING' },
    ],
  });
  assert.deepEqual(summary.works, { total: 2, active: 1, ready: 1, awaitingFinalization: 1 });
  assert.deepEqual(summary.runs, { total: 2, completed: 1, failed: 1, successRate: 50 });
  assert.deepEqual(summary.automation, { total: 3, completed: 1, failed: 1, successRate: 50 });
  assert.deepEqual(summary.publishing, { draftsCreated: 1, publicationsCompleted: 1, failed: 1, pendingApprovals: 1 });
});

test('space operations reports no percentage before terminal executions exist', () => {
  const summary = summarizeSpaceOperations({ automationExecutions: [{ status: 'TRIGGERED' }] }, 7);
  assert.equal(summary.periodDays, 7);
  assert.equal(summary.automation.successRate, null);
  assert.equal(summary.runs.successRate, null);
});
