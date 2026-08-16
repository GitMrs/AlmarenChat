import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { cancellationRequests, recoverInterruptedDiscussions, recoverStaleRunLeases } from './recovery-store.mjs';

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "AgentRun" (
      "id" TEXT PRIMARY KEY, "status" TEXT NOT NULL, "workerId" TEXT,
      "heartbeatAt" TEXT, "updatedAt" TEXT NOT NULL
    );
    CREATE TABLE "AgentTask" (
      "id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL, "agentName" TEXT NOT NULL,
      "status" TEXT NOT NULL, "startedAt" TEXT, "completedAt" TEXT, "updatedAt" TEXT NOT NULL
    );
    CREATE TABLE "AgentSession" (
      "id" TEXT PRIMARY KEY, "status" TEXT NOT NULL, "currentTaskId" TEXT, "updatedAt" TEXT NOT NULL
    );
    CREATE TABLE "SpaceDiscussion" (
      "id" TEXT PRIMARY KEY, "status" TEXT NOT NULL, "completedAt" TEXT, "updatedAt" TEXT NOT NULL
    );
  `);
  return db;
}

test('stale run recovery resets execution and review states for replay', () => {
  const db = database();
  db.exec(`
    INSERT INTO "AgentRun" ("id", "status", "workerId", "heartbeatAt", "updatedAt")
      VALUES ('run-1', 'RUNNING', 'dead-worker', '2026-01-01', 'now');
    INSERT INTO "AgentTask" ("id", "runId", "agentName", "status", "startedAt", "updatedAt")
      VALUES ('task-running', 'run-1', '前端', 'RUNNING', 'before', 'now');
    INSERT INTO "AgentTask" ("id", "runId", "agentName", "status", "startedAt", "updatedAt")
      VALUES ('task-reviewing', 'run-1', '产品', 'REVIEWING', 'before', 'now');
    INSERT INTO "AgentSession" ("id", "status", "currentTaskId", "updatedAt")
      VALUES ('session-1', 'WORKING', 'task-running', 'now');
  `);
  const recovered = recoverStaleRunLeases(db, '2026-02-01', '2026-08-16');
  assert.deepEqual(recovered.map((run) => run.id), ['run-1']);
  assert.equal(db.prepare(`SELECT "status" FROM "AgentRun" WHERE "id" = 'run-1'`).get().status, 'QUEUED');
  assert.equal(db.prepare(`SELECT "status" FROM "AgentTask" WHERE "id" = 'task-running'`).get().status, 'PENDING');
  assert.equal(db.prepare(`SELECT "status" FROM "AgentTask" WHERE "id" = 'task-reviewing'`).get().status, 'SUBMITTED');
  assert.equal(db.prepare(`SELECT "status" FROM "AgentSession" WHERE "id" = 'session-1'`).get().status, 'IDLE');
  db.close();
});

test('recovery exposes cancellation requests and resets interrupted discussions', () => {
  const db = database();
  db.exec(`
    INSERT INTO "AgentRun" ("id", "status", "updatedAt") VALUES ('run-1', 'CANCEL_REQUESTED', 'now');
    INSERT INTO "AgentTask" ("id", "runId", "agentName", "status", "updatedAt")
      VALUES ('task-1', 'run-1', '前端', 'CANCEL_REQUESTED', 'now');
    INSERT INTO "SpaceDiscussion" ("id", "status", "updatedAt") VALUES ('discussion-1', 'RUNNING', 'now');
    INSERT INTO "SpaceDiscussion" ("id", "status", "updatedAt") VALUES ('discussion-2', 'CANCEL_REQUESTED', 'now');
  `);
  const requests = cancellationRequests(db);
  assert.deepEqual(requests.tasks.map((task) => task.id), ['task-1']);
  assert.deepEqual(requests.runs.map((run) => run.id), ['run-1']);
  assert.deepEqual(recoverInterruptedDiscussions(db, '2026-08-16'), { queued: 1, cancelled: 1 });
  db.close();
});
