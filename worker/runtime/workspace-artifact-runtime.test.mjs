import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  prepareWorkspaceAttempt,
  workspaceAttemptFile,
} from '../../lib/workspace-staging.mjs';
import { createWorkspaceArtifactRuntime } from './workspace-artifact-runtime.mjs';

async function fixture() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-artifacts-'));
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "Space" ("id" TEXT PRIMARY KEY, "updatedAt" TEXT);
    CREATE TABLE "SpaceFile" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT, "fileName" TEXT, "mimeType" TEXT,
      "size" INTEGER, "relativePath" TEXT, "runId" TEXT, "taskId" TEXT,
      "workId" TEXT, "status" TEXT, "createdAt" TEXT, "updatedAt" TEXT
    );
    CREATE TABLE "AgentArtifactManifest" (
      "id" TEXT PRIMARY KEY, "runId" TEXT, "taskId" TEXT, "attempt" INTEGER,
      "status" TEXT, "baseline" TEXT, "entries" TEXT, "validation" TEXT,
      "completedAt" TEXT, "createdAt" TEXT, "updatedAt" TEXT,
      UNIQUE("taskId", "attempt")
    );
    INSERT INTO "Space" VALUES ('space-1', 'before');
  `);
  const events = [];
  const runtime = createWorkspaceArtifactRuntime({
    db,
    projectRoot,
    addEvent: (...args) => events.push(args),
    now: () => '2026-08-17T00:00:00.000Z',
  });
  const run = { id: 'run-1', userId: 'user-1', spaceId: 'space-1' };
  const task = {
    id: 'task-1', agentId: 'frontend', agentName: '前端', attempt: 1, mode: 'executor',
  };
  const context = { touchedPaths: new Set() };
  await runtime.ensureTaskArtifactManifest(run, task);
  const options = runtime.taskWorkspaceOptions(run, task);
  await prepareWorkspaceAttempt(options);

  return {
    db,
    events,
    runtime,
    run,
    task,
    context,
    options,
    projectRoot,
    cleanup: async () => {
      db.close();
      await rm(projectRoot, { recursive: true, force: true });
    },
  };
}

test('workspace artifact runtime validates, registers and applies a staged webpage', async () => {
  const current = await fixture();
  try {
    const html = '<!doctype html><html><head><title>Result</title></head><body>done</body></html>';
    await writeFile(workspaceAttemptFile(current.options, 'index.html').target, html, 'utf8');

    const recorded = await current.runtime.recordTaskArtifactManifest(
      current.run,
      current.task,
      current.context,
      { validate: true }
    );
    assert.equal(recorded.status, 'VALIDATED');
    assert.deepEqual([...current.context.touchedPaths], ['index.html']);
    assert.equal(current.db.prepare('SELECT "status" FROM "SpaceFile"').get().status, 'GENERATING');

    const manifest = current.db.prepare(
      'SELECT * FROM "AgentArtifactManifest" WHERE "taskId" = ? AND "attempt" = ?'
    ).get(current.task.id, current.task.attempt);
    await current.runtime.applyAcceptedTaskWorkspace(current.run, current.task, manifest);

    const formalPath = path.join(
      current.projectRoot, 'data', 'spaces', 'user-1', 'space-1', 'workspace', 'index.html'
    );
    assert.equal(await readFile(formalPath, 'utf8'), html);
    assert.equal(current.db.prepare('SELECT "status" FROM "SpaceFile"').get().status, 'READY');
    assert.equal(current.db.prepare('SELECT "status" FROM "AgentArtifactManifest"').get().status, 'APPLIED');
    assert.deepEqual(
      current.events.map((event) => event[1]),
      ['WORKSPACE_FILE_UPDATED', 'ARTIFACT_MANIFEST_RECORDED', 'WEBPAGE_PREVIEW_READY']
    );
  } finally {
    await current.cleanup();
  }
});

test('workspace artifact runtime rejects invalid inline webpage scripts', async () => {
  const current = await fixture();
  try {
    await writeFile(
      workspaceAttemptFile(current.options, 'index.html').target,
      '<!doctype html><script>const = ;</script>',
      'utf8'
    );
    const recorded = await current.runtime.recordTaskArtifactManifest(
      current.run,
      current.task,
      current.context,
      { validate: true }
    );
    assert.equal(recorded.status, 'INCOMPLETE');
    assert.equal(recorded.validation.valid, false);
    assert.match(recorded.validation.issues.join('\n'), /内联脚本语法无效/);
  } finally {
    await current.cleanup();
  }
});

test('workspace artifact runtime rolls files back when database application fails', async () => {
  const current = await fixture();
  try {
    await writeFile(workspaceAttemptFile(current.options, 'result.md').target, '# result', 'utf8');
    await current.runtime.recordTaskArtifactManifest(
      current.run,
      current.task,
      current.context,
      { validate: true }
    );
    const manifest = current.db.prepare('SELECT * FROM "AgentArtifactManifest"').get();
    current.db.exec('DROP TABLE "SpaceFile"');

    await assert.rejects(
      current.runtime.applyAcceptedTaskWorkspace(current.run, current.task, manifest),
      /no such table: SpaceFile/
    );
    assert.equal(current.db.prepare('SELECT "status" FROM "AgentArtifactManifest"').get().status, 'VALIDATED');
    const formalPath = path.join(
      current.projectRoot, 'data', 'spaces', 'user-1', 'space-1', 'workspace', 'result.md'
    );
    await assert.rejects(readFile(formalPath, 'utf8'), /ENOENT/);
  } finally {
    await current.cleanup();
  }
});

test('advisor work without a manifest does not attempt a workspace application', async () => {
  const current = await fixture();
  try {
    await current.runtime.applyAcceptedTaskWorkspace(
      current.run,
      { ...current.task, mode: 'advisor' },
      null
    );
    assert.equal(current.db.prepare('SELECT COUNT(*) AS count FROM "SpaceFile"').get().count, 0);
  } finally {
    await current.cleanup();
  }
});
