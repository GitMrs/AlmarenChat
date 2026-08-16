import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { beginCoordinatorTurn, completeCoordinatorTurn, deferCoordinatorDecision, recoverCoordinatorTurns } from './coordinator-turn-store.mjs';

function database() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE "AgentCoordinatorTurn" ("id" TEXT PRIMARY KEY, "runId" TEXT, "triggerEventId" TEXT,
    "status" TEXT, "inputSnapshot" TEXT, "action" TEXT, "error" TEXT, "modelRequestCount" INTEGER,
    "claimedBy" TEXT, "claimedAt" TEXT, "startedAt" TEXT, "completedAt" TEXT, "createdAt" TEXT, "updatedAt" TEXT,
    UNIQUE("runId", "triggerEventId"));`);
  db.exec(`CREATE TABLE "AgentRun" ("id" TEXT PRIMARY KEY, "status" TEXT, "error" TEXT,
    "coordinatorState" TEXT, "workerId" TEXT, "heartbeatAt" TEXT, "updatedAt" TEXT);`);
  return db;
}

test('coordinator turn is idempotent and records its public action', () => {
  const db = database();
  const first = beginCoordinatorTurn(db, { runId: 'run-1', triggerEventId: 'event-1', workerId: 'worker-1' }, '2026-08-16T00:00:00.000Z');
  assert.equal(first.claimed, true);
  assert.equal(beginCoordinatorTurn(db, { runId: 'run-1', triggerEventId: 'event-1', workerId: 'worker-2' }).claimed, false);
  assert.equal(completeCoordinatorTurn(db, first.turn.id, { decision: 'accept' }), true);
  assert.equal(JSON.parse(db.prepare('SELECT action FROM "AgentCoordinatorTurn"').get().action).decision, 'accept');
  db.close();
});

test('a failed next decision preserves accepted work and leaves the run retryable', () => {
  const db = database();
  db.prepare(`INSERT INTO "AgentRun" ("id", "status", "coordinatorState", "workerId", "updatedAt")
    VALUES (?, 'RUNNING', ?, 'worker-1', 'before')`).run(
    'run-1',
    JSON.stringify({ phase: 'executing', currentTaskIds: ['accepted-task'], authorization: { steps: ['实现页面'] } })
  );
  assert.equal(deferCoordinatorDecision(db, 'run-1', new Error('协调者没有返回有效动作'), 'after'), true);
  const run = db.prepare(`SELECT * FROM "AgentRun" WHERE "id" = 'run-1'`).get();
  assert.equal(run.status, 'BLOCKED');
  assert.match(run.error, /已验收当前成果/);
  assert.equal(run.workerId, null);
  assert.deepEqual(JSON.parse(run.coordinatorState), {
    phase: 'coordinating',
    currentTaskIds: [],
    authorization: { steps: ['实现页面'] },
  });
  db.close();
});

test('stale coordinator turn can be recovered and reclaimed', () => {
  const db = database();
  const first = beginCoordinatorTurn(db, { runId: 'run-1', triggerEventId: 'event-1', workerId: 'worker-1' }, '2026-08-15T00:00:00.000Z');
  assert.equal(recoverCoordinatorTurns(db, '2026-08-16T00:00:00.000Z'), 1);
  const reclaimed = beginCoordinatorTurn(db, { runId: 'run-1', triggerEventId: 'event-1', workerId: 'worker-2' });
  assert.equal(reclaimed.claimed, true);
  assert.equal(reclaimed.turn.id, first.turn.id);
  db.close();
});
