import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { submitTaskCompletion } from './task-completion-store.mjs';

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "AgentRun" ("id" TEXT PRIMARY KEY, "eventSequence" INTEGER NOT NULL DEFAULT 0, "updatedAt" TEXT);
    CREATE TABLE "AgentTask" ("id" TEXT PRIMARY KEY, "runId" TEXT, "attempt" INTEGER, "status" TEXT,
      "result" TEXT, "submittedAt" TEXT, "completedAt" TEXT, "reviewDecision" TEXT, "reviewSummary" TEXT, "updatedAt" TEXT);
    CREATE TABLE "AgentTaskCompletion" ("id" TEXT PRIMARY KEY, "runId" TEXT, "taskId" TEXT, "attempt" INTEGER,
      "workerId" TEXT, "status" TEXT, "report" TEXT, "evidence" TEXT, "artifacts" TEXT, "validation" TEXT,
      "idempotencyKey" TEXT UNIQUE, "active" INTEGER, "createdAt" TEXT);
    CREATE TABLE "AgentRunEvent" ("id" TEXT PRIMARY KEY, "runId" TEXT, "type" TEXT, "message" TEXT, "payload" TEXT,
      "idempotencyKey" TEXT UNIQUE, "sequence" INTEGER, "taskId" TEXT, "agentId" TEXT, "attempt" INTEGER, "actor" TEXT,
      "createdAt" TEXT, UNIQUE("runId", "sequence"));
    CREATE TABLE "AgentRuntimeOutbox" ("id" TEXT PRIMARY KEY, "runId" TEXT, "kind" TEXT, "aggregateId" TEXT,
      "idempotencyKey" TEXT UNIQUE, "payload" TEXT, "status" TEXT, "attempts" INTEGER, "lastError" TEXT,
      "availableAt" TEXT, "claimedBy" TEXT, "claimedAt" TEXT, "deliveredAt" TEXT, "createdAt" TEXT, "updatedAt" TEXT);
    CREATE TABLE "AgentSession" ("id" TEXT PRIMARY KEY, "spaceId" TEXT, "agentId" TEXT, "status" TEXT,
      "currentTaskId" TEXT, "worklog" TEXT, "summary" TEXT, "lastActiveAt" TEXT, "createdAt" TEXT, "updatedAt" TEXT,
      UNIQUE("spaceId", "agentId"));
    INSERT INTO "AgentRun" VALUES ('run-1', 0, 'now');
    INSERT INTO "AgentTask" ("id", "runId", "attempt", "status") VALUES ('task-1', 'run-1', 1, 'RUNNING');
  `);
  return db;
}

test('worker submission atomically persists completion, event, wakeup and session', () => {
  const db = database();
  const input = {
    runId: 'run-1', spaceId: 'space-1', taskId: 'task-1', attempt: 1, workerId: 'worker-1',
    agentId: 'agent-1', agentName: '工程师', report: '已完成', evidence: ['a'], artifacts: ['index.html'], validation: { valid: true },
  };
  const completion = submitTaskCompletion(db, input, '2026-08-16T00:00:00.000Z');
  assert.equal(completion.status, 'SUBMITTED');
  assert.equal(db.prepare('SELECT status FROM "AgentTask"').get().status, 'SUBMITTED');
  assert.equal(db.prepare('SELECT type FROM "AgentRunEvent"').get().type, 'TASK_SUBMITTED');
  assert.equal(db.prepare('SELECT kind FROM "AgentRuntimeOutbox"').get().kind, 'COORDINATOR_WAKEUP');
  assert.equal(db.prepare('SELECT status FROM "AgentSession"').get().status, 'AWAITING_REVIEW');
  assert.equal(submitTaskCompletion(db, input).id, completion.id);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM "AgentTaskCompletion"').get().count, 1);
  db.close();
});
