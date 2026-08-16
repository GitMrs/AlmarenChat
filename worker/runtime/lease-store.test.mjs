import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { claimNextDiscussion, claimNextRun, heartbeatRunLease, releaseRunLease } from './lease-store.mjs';

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "AgentRun" (
      "id" TEXT PRIMARY KEY, "status" TEXT NOT NULL, "workerId" TEXT, "heartbeatAt" TEXT,
      "startedAt" TEXT, "createdAt" TEXT NOT NULL, "updatedAt" TEXT NOT NULL
    );
    CREATE TABLE "SpaceDiscussion" (
      "id" TEXT PRIMARY KEY, "status" TEXT NOT NULL, "startedAt" TEXT,
      "createdAt" TEXT NOT NULL, "updatedAt" TEXT NOT NULL
    );
  `);
  return db;
}

test('oldest queued run is claimed once and owned by one worker', () => {
  const db = database();
  db.exec(`
    INSERT INTO "AgentRun" ("id", "status", "createdAt", "updatedAt") VALUES ('run-2', 'QUEUED', '2026-02-01', 'now');
    INSERT INTO "AgentRun" ("id", "status", "createdAt", "updatedAt") VALUES ('run-1', 'QUEUED', '2026-01-01', 'now');
  `);
  const run = claimNextRun(db, 'worker-1', '2026-08-16T00:00:00.000Z');
  assert.equal(run.id, 'run-1');
  assert.equal(run.workerId, 'worker-1');
  assert.equal(heartbeatRunLease(db, 'run-1', 'worker-2', 'later'), false);
  assert.equal(heartbeatRunLease(db, 'run-1', 'worker-1', 'later'), true);
  assert.equal(releaseRunLease(db, 'run-1', 'worker-1'), false);
  db.prepare(`UPDATE "AgentRun" SET "status" = 'WAITING_APPROVAL' WHERE "id" = 'run-1'`).run();
  assert.equal(releaseRunLease(db, 'run-1', 'worker-1'), true);
  db.close();
});

test('discussion claiming preserves its first start time', () => {
  const db = database();
  db.exec(`INSERT INTO "SpaceDiscussion" ("id", "status", "createdAt", "updatedAt") VALUES ('discussion-1', 'QUEUED', 'now', 'now')`);
  const discussion = claimNextDiscussion(db, '2026-08-16T00:00:00.000Z');
  assert.equal(discussion.status, 'RUNNING');
  assert.equal(discussion.startedAt, '2026-08-16T00:00:00.000Z');
  assert.equal(claimNextDiscussion(db), null);
  db.close();
});
