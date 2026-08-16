import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { beginCoordinatorTurn, completeCoordinatorTurn, recoverCoordinatorTurns } from './coordinator-turn-store.mjs';

function database() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE "AgentCoordinatorTurn" ("id" TEXT PRIMARY KEY, "runId" TEXT, "triggerEventId" TEXT,
    "status" TEXT, "inputSnapshot" TEXT, "action" TEXT, "error" TEXT, "modelRequestCount" INTEGER,
    "claimedBy" TEXT, "claimedAt" TEXT, "startedAt" TEXT, "completedAt" TEXT, "createdAt" TEXT, "updatedAt" TEXT,
    UNIQUE("runId", "triggerEventId"));`);
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

test('stale coordinator turn can be recovered and reclaimed', () => {
  const db = database();
  const first = beginCoordinatorTurn(db, { runId: 'run-1', triggerEventId: 'event-1', workerId: 'worker-1' }, '2026-08-15T00:00:00.000Z');
  assert.equal(recoverCoordinatorTurns(db, '2026-08-16T00:00:00.000Z'), 1);
  const reclaimed = beginCoordinatorTurn(db, { runId: 'run-1', triggerEventId: 'event-1', workerId: 'worker-2' });
  assert.equal(reclaimed.claimed, true);
  assert.equal(reclaimed.turn.id, first.turn.id);
  db.close();
});
