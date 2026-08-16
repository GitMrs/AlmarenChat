import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { appendRunEvent, listRunEventsAfter } from './event-store.mjs';

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "AgentRun" (
      "id" TEXT PRIMARY KEY, "eventSequence" INTEGER NOT NULL DEFAULT 0, "updatedAt" TEXT NOT NULL
    );
    CREATE TABLE "AgentRunEvent" (
      "id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL, "type" TEXT NOT NULL, "message" TEXT NOT NULL,
      "payload" TEXT, "idempotencyKey" TEXT UNIQUE, "sequence" INTEGER NOT NULL,
      "taskId" TEXT, "agentId" TEXT, "attempt" INTEGER, "actor" TEXT, "createdAt" TEXT NOT NULL,
      UNIQUE("runId", "sequence")
    );
    INSERT INTO "AgentRun" ("id", "updatedAt") VALUES ('run-1', 'now');
  `);
  return db;
}

test('run events receive an atomic monotonic sequence', () => {
  const db = database();
  appendRunEvent(db, { runId: 'run-1', type: 'ONE', message: 'one' });
  appendRunEvent(db, { runId: 'run-1', type: 'TWO', message: 'two', taskId: 'task-1' });
  assert.deepEqual(
    listRunEventsAfter(db, 'run-1', 0).map((event) => [event.sequence, event.type]),
    [[1, 'ONE'], [2, 'TWO']]
  );
  assert.equal(listRunEventsAfter(db, 'run-1', 1)[0].type, 'TWO');
  db.close();
});

test('idempotent event replay does not advance the sequence', () => {
  const db = database();
  const event = { runId: 'run-1', type: 'ONLY', message: 'only', idempotencyKey: 'event:only' };
  const first = appendRunEvent(db, event);
  const replay = appendRunEvent(db, event);
  assert.equal(replay.id, first.id);
  assert.equal(db.prepare('SELECT "eventSequence" FROM "AgentRun"').get().eventSequence, 1);
  db.close();
});
