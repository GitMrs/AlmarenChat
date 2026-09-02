import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  loadCoordinatorAcceptanceEvidence,
  loadCoordinatorDecisionContext,
  readCoordinatorState,
} from './coordinator-context.mjs';

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "AgentRun" ("id" TEXT PRIMARY KEY, "coordinatorState" TEXT);
    CREATE TABLE "AgentTask" (
      "id" TEXT PRIMARY KEY, "runId" TEXT, "status" TEXT, "sortOrder" INTEGER
    );
    CREATE TABLE "AgentSession" (
      "spaceId" TEXT, "agentId" TEXT, "status" TEXT, "currentTaskId" TEXT
    );
    CREATE TABLE "AgentArtifactManifest" (
      "id" TEXT PRIMARY KEY, "runId" TEXT, "createdAt" TEXT
    );
    CREATE TABLE "AgentRunEvent" (
      "runId" TEXT, "type" TEXT, "message" TEXT, "payload" TEXT, "createdAt" TEXT
    );
  `);
  return db;
}

test('coordinator context recovers state and partitions tasks without changing order', () => {
  const db = database();
  db.prepare('INSERT INTO "AgentRun" VALUES (?, ?)').run(
    'run-1',
    JSON.stringify({ authorization: { objective: '目标', maxTasks: 3 } })
  );
  const insertTask = db.prepare('INSERT INTO "AgentTask" VALUES (?, ?, ?, ?)');
  insertTask.run('task-2', 'run-1', 'COMPLETED', 2);
  insertTask.run('task-1', 'run-1', 'PENDING', 1);
  db.prepare('INSERT INTO "AgentSession" VALUES (?, ?, ?, ?)').run(
    'space-1', 'frontend', 'WORKING', 'task-1'
  );

  const context = loadCoordinatorDecisionContext(
    db,
    { id: 'run-1', spaceId: 'space-1', input: '用户目标' },
    [
      { id: 'frontend', name: '前端', category: '开发', description: '实现页面' },
      { id: 'product', name: '产品' },
    ]
  );

  assert.deepEqual(context.existingTasks.map((task) => task.id), ['task-1', 'task-2']);
  assert.deepEqual(context.activeTasks.map((task) => task.id), ['task-1']);
  assert.deepEqual(context.completedTasks.map((task) => task.id), ['task-2']);
  assert.equal(context.remainingTasks, 1);
  assert.deepEqual(context.team.map(({ availableSkills: _availableSkills, ...member }) => member), [
    {
      id: 'frontend', name: '前端', category: '开发', description: '实现页面',
      status: 'WORKING', currentTaskId: 'task-1',
    },
    {
      id: 'product', name: '产品', category: '普通成员', description: '',
      status: 'IDLE', currentTaskId: null,
    },
  ]);
  assert.deepEqual(context.team[0].availableSkills.map((skill) => skill.id), [
    'image-generator', 'professional-analysis', 'document-writer', 'csv-business-analysis', 'responsive-page-builder',
  ]);
  assert.deepEqual(context.team[1].availableSkills.map((skill) => skill.id), [
    'professional-analysis', 'document-writer', 'csv-business-analysis',
  ]);
  db.close();
});

test('coordinator context falls back safely when persisted state is malformed', () => {
  const db = database();
  db.prepare('INSERT INTO "AgentRun" VALUES (?, ?)').run('run-1', '{invalid');
  assert.deepEqual(readCoordinatorState(db, 'run-1'), {});
  const context = loadCoordinatorDecisionContext(
    db,
    { id: 'run-1', spaceId: 'space-1', input: '用户目标' },
    []
  );
  assert.equal(context.authorization.objective, '用户目标');
  assert.equal(context.authorization.maxTasks, 8);
  assert.equal(context.remainingTasks, 8);
  db.close();
});

test('coordinator acceptance evidence preserves deterministic database order', () => {
  const db = database();
  const insertTask = db.prepare('INSERT INTO "AgentTask" VALUES (?, ?, ?, ?)');
  insertTask.run('task-2', 'run-1', 'COMPLETED', 2);
  insertTask.run('task-1', 'run-1', 'COMPLETED', 1);
  db.prepare('INSERT INTO "AgentArtifactManifest" VALUES (?, ?, ?)').run(
    'manifest-1', 'run-1', '2026-08-17T00:00:01.000Z'
  );
  db.prepare('INSERT INTO "AgentRunEvent" VALUES (?, ?, ?, ?, ?)').run(
    'run-1', 'TASK_ACCEPTED', '通过', '{}', '2026-08-17T00:00:02.000Z'
  );

  const evidence = loadCoordinatorAcceptanceEvidence(db, 'run-1');
  assert.deepEqual(evidence.tasks.map((task) => task.id), ['task-1', 'task-2']);
  assert.deepEqual(evidence.manifests.map((manifest) => manifest.id), ['manifest-1']);
  assert.deepEqual(evidence.events.map((event) => event.type), ['TASK_ACCEPTED']);
  db.close();
});
