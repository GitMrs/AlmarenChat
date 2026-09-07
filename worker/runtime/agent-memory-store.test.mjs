import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { loadAgentMemoryContextSync, recordAcceptedAgentExperiences } from './agent-memory-store.mjs';

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "AgentExperience" (
      "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "agentId" TEXT NOT NULL, "spaceId" TEXT,
      "runId" TEXT, "taskId" TEXT NOT NULL, "title" TEXT NOT NULL, "summary" TEXT NOT NULL,
      "outcome" TEXT NOT NULL, "tags" TEXT, "createdAt" TEXT NOT NULL, "updatedAt" TEXT NOT NULL,
      UNIQUE("userId", "agentId", "taskId")
    );
    CREATE TABLE "AgentMemoryRule" (
      "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "agentId" TEXT NOT NULL, "category" TEXT NOT NULL,
      "title" TEXT NOT NULL, "instruction" TEXT NOT NULL, "status" TEXT NOT NULL,
      "evidenceCount" INTEGER NOT NULL, "updatedAt" TEXT NOT NULL
    );
  `);
  return db;
}

test('accepted task experience is idempotent and isolated per user and agent', () => {
  const db = database();
  const input = {
    run: { id: 'run-1', userId: 'user-1', spaceId: 'space-a' },
    tasks: [{ id: 'task-1', agentId: 'writer', title: '写文章', result: '完成初稿', status: 'COMPLETED', mode: 'executor' }],
    accepted: true,
    timestamp: '2026-09-07T00:00:00.000Z',
  };
  recordAcceptedAgentExperiences(db, input);
  recordAcceptedAgentExperiences(db, { ...input, tasks: [{ ...input.tasks[0], result: '完成终稿' }] });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "AgentExperience"').get().count, 1);
  assert.equal(db.prepare('SELECT "summary" FROM "AgentExperience"').get().summary, '完成终稿');
  assert.equal(loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'writer', query: '文章' }), '');
  assert.equal(loadAgentMemoryContextSync(db, { userId: 'user-2', agentId: 'writer', query: '文章' }), '');
  db.close();
});

test('only active rules enter worker memory context', () => {
  const db = database();
  const insert = db.prepare(`INSERT INTO "AgentMemoryRule" VALUES (?, 'user-1', 'writer', 'correction', ?, ?, ?, 1, 'now')`);
  insert.run('active', '已确认', '先确认受众', 'ACTIVE');
  insert.run('pending', '待确认', '泄露到上下文', 'PENDING');
  const context = loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'writer', query: '受众' });
  assert.match(context, /先确认受众/);
  assert.doesNotMatch(context, /泄露到上下文/);
  db.close();
});
