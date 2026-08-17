import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createWorkspaceRecoveryRuntime } from './workspace-recovery-runtime.mjs';

function fixture(overrides = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "AgentRun" (
      "id" TEXT PRIMARY KEY, "retryOfId" TEXT, "userId" TEXT, "spaceId" TEXT
    );
    CREATE TABLE "AgentTask" (
      "id" TEXT PRIMARY KEY, "runId" TEXT, "attempt" INTEGER
    );
    CREATE TABLE "AgentArtifactManifest" (
      "id" TEXT PRIMARY KEY, "runId" TEXT, "taskId" TEXT, "attempt" INTEGER,
      "status" TEXT, "baseline" TEXT, "entries" TEXT, "createdAt" TEXT, "updatedAt" TEXT
    );
    CREATE TABLE "AgentRunEvent" (
      "runId" TEXT, "type" TEXT, "payload" TEXT, "createdAt" TEXT
    );
  `);
  const events = [];
  const discarded = [];
  const recovered = [];
  const runtime = createWorkspaceRecoveryRuntime({
    db,
    projectRoot: 'C:/project',
    addEvent: (...args) => events.push(args),
    now: () => '2026-08-17T00:00:00.000Z',
    discardAttemptSync: (options) => discarded.push(options),
    recoverApplication: async (...args) => recovered.push(args),
    ...overrides,
  });
  return { db, discarded, events, recovered, runtime };
}

test('workspace recovery restores interrupted applications and closes the manifest', async () => {
  const current = fixture();
  current.db.exec(`
    INSERT INTO "AgentRun" VALUES ('run-1', NULL, 'user-1', 'space-1');
    INSERT INTO "AgentArtifactManifest" VALUES (
      'manifest-1', 'run-1', 'task-1', 2, 'APPLYING', '{"files":[]}',
      '[{"path":"index.html","change":"CREATED"}]', 'before', 'before'
    );
  `);
  await current.runtime.recoverInterruptedWorkspaceApplications();
  assert.equal(current.recovered.length, 1);
  assert.equal(current.recovered[0][0].attempt, 2);
  assert.equal(current.db.prepare('SELECT "status" FROM "AgentArtifactManifest"').get().status, 'VALIDATED');
  assert.equal(current.events[0][1], 'WORKSPACE_APPLICATION_RECOVERED');
  current.db.close();
});

test('workspace recovery cleans closed and task-scoped staging attempts', () => {
  const current = fixture();
  current.db.exec(`
    INSERT INTO "AgentRun" VALUES ('run-1', NULL, 'user-1', 'space-1');
    INSERT INTO "AgentTask" VALUES ('task-1', 'run-1', 3);
    INSERT INTO "AgentArtifactManifest" VALUES (
      'manifest-1', 'run-1', 'task-1', 2, 'APPLIED', '{}', '[]', 'before', 'before'
    );
  `);
  current.runtime.cleanupClosedWorkspaceAttempts();
  current.runtime.discardTaskWorkspace('run-1', 'task-1');
  assert.deepEqual(current.discarded.map((options) => options.attempt), [2, 3]);
  current.db.close();
});

test('workspace recovery restores touched paths across retry lineage', () => {
  const current = fixture();
  current.db.exec(`
    INSERT INTO "AgentRun" VALUES ('run-1', NULL, 'user-1', 'space-1');
    INSERT INTO "AgentRun" VALUES ('run-2', 'run-1', 'user-1', 'space-1');
    INSERT INTO "AgentRunEvent" VALUES (
      'run-1', 'TOOL_COMPLETED', '{"tool":"write_file","path":"first.md"}', '1'
    );
    INSERT INTO "AgentArtifactManifest" VALUES (
      'manifest-2', 'run-2', 'task-2', 1, 'VALIDATED', '{}',
      '[{"path":"second.html","change":"MODIFIED"}]', '2', '2'
    );
  `);
  const touched = new Set();
  current.runtime.restoreTouchedPaths('run-2', touched);
  assert.deepEqual([...touched], ['first.md', 'second.html']);
  current.db.close();
});
