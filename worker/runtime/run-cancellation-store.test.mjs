import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { cancelRunRecord } from './run-cancellation-store.mjs';

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "AgentRun" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT NOT NULL, "input" TEXT NOT NULL, "status" TEXT NOT NULL,
      "workerId" TEXT, "heartbeatAt" TEXT, "completionId" TEXT, "completedAt" TEXT,
      "eventSequence" INTEGER NOT NULL DEFAULT 0, "updatedAt" TEXT NOT NULL
    );
    CREATE TABLE "AgentTask" (
      "id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL, "status" TEXT NOT NULL,
      "completedAt" TEXT, "updatedAt" TEXT NOT NULL
    );
    CREATE TABLE "SpaceFile" (
      "id" TEXT PRIMARY KEY, "runId" TEXT, "status" TEXT NOT NULL
    );
    CREATE TABLE "AgentSession" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT NOT NULL, "status" TEXT NOT NULL,
      "currentTaskId" TEXT, "updatedAt" TEXT NOT NULL
    );
    CREATE TABLE "AgentRunEvent" (
      "id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL, "type" TEXT NOT NULL, "message" TEXT NOT NULL,
      "payload" TEXT, "idempotencyKey" TEXT UNIQUE, "sequence" INTEGER NOT NULL,
      "taskId" TEXT, "agentId" TEXT, "attempt" INTEGER, "actor" TEXT, "createdAt" TEXT NOT NULL,
      UNIQUE("runId", "sequence")
    );
    CREATE TABLE "AgentRunOutbox" (
      "id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL UNIQUE,
      "payload" TEXT NOT NULL, "status" TEXT NOT NULL, "attempts" INTEGER NOT NULL,
      "availableAt" TEXT NOT NULL, "createdAt" TEXT NOT NULL, "updatedAt" TEXT NOT NULL
    );
  `);
  return db;
}

test('missing run cancellation is a no-op instead of a worker-fatal error', () => {
  const db = database();
  const result = cancelRunRecord(db, 'deleted-run', '2026-08-16T00:00:00.000Z');
  assert.deepEqual(result, { outcome: 'MISSING', taskIds: [], run: null });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "AgentRunEvent"').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "AgentRunOutbox"').get().count, 0);
  db.close();
});

test('run cancellation atomically records its terminal event and completion', () => {
  const db = database();
  db.exec(`
    INSERT INTO "AgentRun" ("id", "spaceId", "input", "status", "workerId", "updatedAt")
      VALUES ('run-1', 'space-1', '完成页面', 'RUNNING', 'worker-1', 'now');
    INSERT INTO "AgentTask" ("id", "runId", "status", "updatedAt")
      VALUES ('task-1', 'run-1', 'RUNNING', 'now');
    INSERT INTO "SpaceFile" ("id", "runId", "status") VALUES ('file-1', 'run-1', 'GENERATING');
    INSERT INTO "AgentSession" ("id", "spaceId", "status", "currentTaskId", "updatedAt")
      VALUES ('session-1', 'space-1', 'WORKING', 'task-1', 'now');
  `);

  const first = cancelRunRecord(db, 'run-1', '2026-08-16T00:00:00.000Z');
  assert.equal(first.outcome, 'CANCELLED');
  assert.deepEqual(first.taskIds, ['task-1']);
  assert.equal(db.prepare('SELECT "status" FROM "AgentRun" WHERE "id" = ?').get('run-1').status, 'CANCELLED');
  assert.equal(db.prepare('SELECT "status" FROM "AgentTask" WHERE "id" = ?').get('task-1').status, 'CANCELLED');
  assert.equal(db.prepare('SELECT "status" FROM "AgentSession" WHERE "id" = ?').get('session-1').status, 'IDLE');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "SpaceFile"').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "AgentRunEvent"').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "AgentRunOutbox"').get().count, 1);

  const replay = cancelRunRecord(db, 'run-1', '2026-08-16T00:01:00.000Z');
  assert.equal(replay.outcome, 'ALREADY_CANCELLED');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "AgentRunEvent"').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "AgentRunOutbox"').get().count, 1);
  db.close();
});
