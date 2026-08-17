import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createPlanRuntime } from './plan-runtime.mjs';

function fixture(overrides = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "AgentRun" (
      "id" TEXT PRIMARY KEY, "status" TEXT, "coordinatorState" TEXT, "updatedAt" TEXT
    );
    CREATE TABLE "AgentTask" (
      "id" TEXT PRIMARY KEY, "runId" TEXT, "agentId" TEXT, "agentName" TEXT,
      "title" TEXT, "instruction" TEXT, "acceptanceCriteria" TEXT, "origin" TEXT,
      "mode" TEXT, "dependsOn" TEXT, "modelRequestLimit" INTEGER, "status" TEXT,
      "sortOrder" INTEGER, "proposedAt" TEXT, "approvedAt" TEXT,
      "createdAt" TEXT, "updatedAt" TEXT
    );
  `);
  const events = [];
  const runtime = createPlanRuntime({
    db,
    complete: async () => JSON.stringify({
      tasks: [{
        agentId: 'missing', title: '实现页面', instruction: '创建页面', deliverables: ['index.html'],
      }],
    }),
    addEvent: (...args) => events.push(args),
    now: () => '2026-08-17T00:00:00.000Z',
    ...overrides,
  });
  return { db, events, runtime };
}

test('plan runtime normalizes model plans against the available team', async () => {
  const current = fixture();
  const agents = [{ id: 'frontend', name: '前端', description: '实现网页' }];
  const plan = await current.runtime.createPlan(
    { id: 'run-1', input: '制作网页' },
    { agents, model: {}, space: { name: '项目空间', instructions: '' }, projectMemory: '' }
  );
  assert.deepEqual(plan, [{
    agentId: 'frontend',
    title: '实现页面',
    instruction: '创建页面\n\n独立验收产物：index.html',
    deliverables: ['index.html'],
  }]);
  current.db.close();
});

test('plan runtime persists a legacy plan and its public event atomically', () => {
  const current = fixture();
  current.db.prepare('INSERT INTO "AgentRun" VALUES (?, ?, ?, ?)').run('run-1', 'PLANNING', null, 'before');
  current.runtime.savePlan(
    'run-1',
    [{ agentId: 'frontend', title: '实现页面', instruction: '创建 index.html' }],
    [{ id: 'frontend', name: '前端' }]
  );
  const task = current.db.prepare('SELECT * FROM "AgentTask"').get();
  assert.equal(task.agentName, '前端');
  assert.equal(task.status, 'PENDING');
  assert.equal(current.db.prepare('SELECT "status" FROM "AgentRun"').get().status, 'RUNNING');
  assert.equal(current.events[0][1], 'PLAN_CREATED');
  current.db.close();
});

test('plan runtime dispatches only authorized V2 work whose dependencies are complete', () => {
  const current = fixture();
  const authorizedPlan = [
    {
      agentId: 'product', agentName: '产品', title: '定义需求', instruction: '整理需求',
      acceptanceCriteria: '需求明确', mode: 'advisor', dependsOn: [],
    },
    {
      agentId: 'frontend', agentName: '前端', title: '实现页面', instruction: '创建页面',
      acceptanceCriteria: '页面可用', mode: 'executor', dependsOn: [0],
    },
  ];
  current.db.prepare('INSERT INTO "AgentRun" VALUES (?, ?, ?, ?)').run(
    'run-1', 'QUEUED', JSON.stringify({ authorizedPlan, dispatched: [0], cursor: 1 }), 'before'
  );
  current.db.prepare(`
    INSERT INTO "AgentTask"
    ("id", "runId", "agentId", "agentName", "title", "instruction", "status", "sortOrder")
    VALUES ('task-0', 'run-1', 'product', '产品', '定义需求', '整理需求', 'COMPLETED', 0)
  `).run();

  const tasks = current.runtime.dispatchNextAuthorizedTask({ id: 'run-1', runtimeVersion: 2 });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].agentId, 'frontend');
  assert.equal(tasks[0].sortOrder, 1);
  assert.equal(current.events[0][1], 'COORDINATOR_TASK_DISPATCHED');
  const state = JSON.parse(current.db.prepare('SELECT "coordinatorState" FROM "AgentRun"').get().coordinatorState);
  assert.deepEqual(state.dispatched, [0, 1]);
  assert.equal(state.phase, 'executing');
  current.db.close();
});
