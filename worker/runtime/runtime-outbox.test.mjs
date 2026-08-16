import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  OUTBOX_KINDS,
  claimRuntimeIntent,
  completeRuntimeIntent,
  enqueueRuntimeIntent,
  recoverRuntimeIntents,
} from './runtime-outbox.mjs';

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "AgentRuntimeOutbox" (
      "id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL, "kind" TEXT NOT NULL, "aggregateId" TEXT NOT NULL,
      "idempotencyKey" TEXT NOT NULL UNIQUE, "payload" TEXT NOT NULL, "status" TEXT NOT NULL,
      "attempts" INTEGER NOT NULL, "lastError" TEXT, "availableAt" TEXT NOT NULL,
      "claimedBy" TEXT, "claimedAt" TEXT, "deliveredAt" TEXT,
      "createdAt" TEXT NOT NULL, "updatedAt" TEXT NOT NULL
    );
  `);
  return db;
}

test('runtime intent is idempotent and claimable', () => {
  const db = database();
  const intent = {
    runId: 'run-1',
    kind: OUTBOX_KINDS.COORDINATOR_WAKEUP,
    aggregateId: 'completion-1',
    idempotencyKey: 'wake:completion-1',
    payload: { completionId: 'completion-1' },
  };
  enqueueRuntimeIntent(db, intent, '2026-08-16T00:00:00.000Z');
  enqueueRuntimeIntent(db, intent, '2026-08-16T00:00:00.000Z');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "AgentRuntimeOutbox"').get().count, 1);
  const claimed = claimRuntimeIntent(db, 'worker-1', '2026-08-16T00:00:01.000Z');
  assert.equal(claimed.kind, OUTBOX_KINDS.COORDINATOR_WAKEUP);
  assert.equal(completeRuntimeIntent(db, claimed.id, '2026-08-16T00:00:02.000Z'), true);
  db.close();
});

test('stale runtime intent is recovered', () => {
  const db = database();
  enqueueRuntimeIntent(db, {
    runId: 'run-1', kind: OUTBOX_KINDS.CHAT_PROJECTION, aggregateId: 'message-1',
    idempotencyKey: 'message-1', payload: {},
  }, '2026-08-16T00:00:00.000Z');
  claimRuntimeIntent(db, 'worker-1', '2026-08-16T00:00:01.000Z');
  assert.equal(recoverRuntimeIntents(db, '2026-08-16T00:00:30.000Z', '2026-08-16T00:01:00.000Z'), 1);
  db.close();
});
