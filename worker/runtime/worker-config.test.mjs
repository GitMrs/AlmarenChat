import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { resolveWorkerDatabasePath, workerConfig } from './worker-config.mjs';

test('worker config applies bounded runtime defaults', () => {
  assert.deepEqual(workerConfig({}), {
    pollIntervalMs: 1_200,
    modelTimeoutMs: 180_000,
    heartbeatIntervalMs: 5_000,
    leaseTimeoutMs: 30_000,
    taskTimeoutMs: 600_000,
    fakeMode: false,
  });
  const configured = workerConfig({
    AGENT_WORKER_POLL_MS: '10',
    AGENT_MODEL_TIMEOUT_MS: '500000',
    AGENT_WORKER_HEARTBEAT_MS: '2000',
    AGENT_WORKER_LEASE_TIMEOUT_MS: '1000',
    AGENT_TASK_TIMEOUT_MS: '100',
    AGENT_WORKER_FAKE: '1',
  });
  assert.equal(configured.pollIntervalMs, 250);
  assert.equal(configured.modelTimeoutMs, 300_000);
  assert.equal(configured.heartbeatIntervalMs, 2_000);
  assert.equal(configured.leaseTimeoutMs, 6_000);
  assert.equal(configured.taskTimeoutMs, 300_000);
  assert.equal(configured.fakeMode, true);
});

test('worker database path accepts only SQLite file URLs', () => {
  assert.equal(resolveWorkerDatabasePath('/project', { DATABASE_URL: 'file:./data/dev.db' }), path.resolve('/project/data/dev.db'));
  assert.throws(
    () => resolveWorkerDatabasePath('/project', { DATABASE_URL: 'postgresql://localhost/app' }),
    /仅支持 SQLite/
  );
});
