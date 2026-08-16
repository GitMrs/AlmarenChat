import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  claimNextCompletion,
  completionIdFor,
  deliverCompletion,
  enqueueCompletion,
  reconcileCompletionOutbox,
  recoverStaleOutbox,
} from './completion-outbox.mjs';

function testDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "Space" ("id" TEXT PRIMARY KEY, "updatedAt" TEXT NOT NULL);
    CREATE TABLE "SpaceMessage" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT NOT NULL, "role" TEXT NOT NULL,
      "speakerAgentId" TEXT, "content" TEXT NOT NULL, "attachments" TEXT,
      "sourceKey" TEXT UNIQUE, "createdAt" TEXT NOT NULL
    );
    CREATE TABLE "AgentRun" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT NOT NULL, "status" TEXT NOT NULL,
      "result" TEXT, "error" TEXT, "completionId" TEXT UNIQUE
    );
    CREATE TABLE "AgentRunOutbox" (
      "id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL UNIQUE, "idempotencyKey" TEXT NOT NULL UNIQUE,
      "payload" TEXT NOT NULL, "status" TEXT NOT NULL, "attempts" INTEGER NOT NULL,
      "lastError" TEXT, "availableAt" TEXT NOT NULL, "claimedBy" TEXT, "claimedAt" TEXT,
      "deliveredAt" TEXT, "createdAt" TEXT NOT NULL, "updatedAt" TEXT NOT NULL
    );
    INSERT INTO "Space" ("id", "updatedAt") VALUES ('space-1', '2026-08-15T00:00:00.000Z');
  `);
  return db;
}

test('completion outbox stages and delivers one chat message idempotently', () => {
  const db = testDatabase();
  const payload = { runId: 'run-1', spaceId: 'space-1', status: 'COMPLETED', result: '交付完成' };
  db.prepare(
    `INSERT INTO "AgentRun" ("id", "spaceId", "status", "result", "completionId") VALUES (?, ?, ?, ?, ?)`
  ).run('run-1', 'space-1', 'COMPLETED', '交付完成', completionIdFor('run-1'));
  enqueueCompletion(db, payload, '2026-08-15T10:00:00.000Z');
  enqueueCompletion(db, payload, '2026-08-15T10:00:00.000Z');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "AgentRunOutbox"').get().count, 1);

  const entry = claimNextCompletion(db, 'worker-1', '2026-08-15T10:00:01.000Z');
  deliverCompletion(db, entry, '2026-08-15T10:00:02.000Z');
  db.prepare(`UPDATE "AgentRunOutbox" SET "status" = 'PROCESSING' WHERE "id" = ?`).run(entry.id);
  deliverCompletion(db, entry, '2026-08-15T10:00:03.000Z');

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "SpaceMessage"').get().count, 1);
  assert.equal(db.prepare('SELECT "sourceKey" FROM "SpaceMessage"').get().sourceKey, completionIdFor('run-1'));
  assert.equal(db.prepare('SELECT "status" FROM "AgentRunOutbox"').get().status, 'DELIVERED');
  db.close();
});

test('a claimed completion cannot recreate chat after its run was cleared', () => {
  const db = testDatabase();
  const payload = { runId: 'run-cleared', spaceId: 'space-1', status: 'COMPLETED', result: '旧结果' };
  db.prepare(
    `INSERT INTO "AgentRun" ("id", "spaceId", "status", "result", "completionId") VALUES (?, ?, ?, ?, ?)`
  ).run('run-cleared', 'space-1', 'COMPLETED', '旧结果', completionIdFor('run-cleared'));
  enqueueCompletion(db, payload, '2026-08-15T10:00:00.000Z');
  const entry = claimNextCompletion(db, 'worker-1', '2026-08-15T10:00:01.000Z');
  db.prepare(`DELETE FROM "AgentRun" WHERE "id" = ?`).run('run-cleared');

  deliverCompletion(db, entry, '2026-08-15T10:00:02.000Z');

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "SpaceMessage"').get().count, 0);
  db.close();
});

test('completion reconciliation repairs one missing outbox entry', () => {
  const db = testDatabase();
  db.prepare(
    `INSERT INTO "AgentRun" ("id", "spaceId", "status", "result", "completionId") VALUES (?, ?, ?, ?, ?)`
  ).run('run-orphan', 'space-1', 'COMPLETED', '已完成', completionIdFor('run-orphan'));
  assert.equal(reconcileCompletionOutbox(db, '2026-08-15T10:00:00.000Z'), 1);
  assert.equal(reconcileCompletionOutbox(db, '2026-08-15T10:00:01.000Z'), 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "AgentRunOutbox"').get().count, 1);
  db.close();
});

test('stale processing outbox entries return to pending', () => {
  const db = testDatabase();
  enqueueCompletion(db, { runId: 'run-2', spaceId: 'space-1', status: 'FAILED', error: '失败' }, '2026-08-15T10:00:00.000Z');
  claimNextCompletion(db, 'worker-1', '2026-08-15T10:00:01.000Z');
  assert.equal(recoverStaleOutbox(db, '2026-08-15T10:00:30.000Z', '2026-08-15T10:01:00.000Z'), 1);
  assert.equal(db.prepare('SELECT "status" FROM "AgentRunOutbox"').get().status, 'PENDING');
  db.close();
});
