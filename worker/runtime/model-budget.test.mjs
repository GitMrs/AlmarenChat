import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { reserveModelRequest } from './model-budget.mjs';

function fixture(runLimit = 3, taskLimit = 2) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE AgentRun (id TEXT PRIMARY KEY, modelRequestCount INTEGER NOT NULL, modelRequestLimit INTEGER NOT NULL, updatedAt TEXT);
    CREATE TABLE AgentTask (id TEXT PRIMARY KEY, runId TEXT NOT NULL, modelRequestCount INTEGER NOT NULL, modelRequestLimit INTEGER NOT NULL, updatedAt TEXT);
  `);
  db.prepare('INSERT INTO AgentRun VALUES (?, 0, ?, NULL)').run('run-1', runLimit);
  db.prepare('INSERT INTO AgentTask VALUES (?, ?, 0, ?, NULL)').run('task-1', 'run-1', taskLimit);
  return db;
}

test('reserves run and task budgets atomically for each provider attempt', () => {
  const db = fixture();
  assert.deepEqual(reserveModelRequest(db, 'run-1', 'task-1', 'now'), {
    runCount: 1,
    runLimit: 3,
    taskCount: 1,
    taskLimit: 2,
  });
  assert.equal(db.prepare('SELECT modelRequestCount FROM AgentRun').get().modelRequestCount, 1);
  assert.equal(db.prepare('SELECT modelRequestCount FROM AgentTask').get().modelRequestCount, 1);
  db.close();
});

test('task exhaustion does not consume the remaining run budget', () => {
  const db = fixture(3, 1);
  reserveModelRequest(db, 'run-1', 'task-1');
  assert.throws(() => reserveModelRequest(db, 'run-1', 'task-1'), (error) => {
    assert.equal(error.code, 'MODEL_REQUEST_BUDGET');
    assert.equal(error.scope, 'task');
    assert.equal(error.count, 1);
    assert.equal(error.limit, 1);
    return true;
  });
  assert.equal(db.prepare('SELECT modelRequestCount FROM AgentRun').get().modelRequestCount, 1);
  assert.equal(db.prepare('SELECT modelRequestCount FROM AgentTask').get().modelRequestCount, 1);
  db.close();
});

test('run-only calls share the same durable limit', () => {
  const db = fixture(1, 2);
  reserveModelRequest(db, 'run-1');
  assert.throws(() => reserveModelRequest(db, 'run-1'), (error) => {
    assert.equal(error.code, 'MODEL_REQUEST_BUDGET');
    assert.equal(error.scope, 'run');
    assert.equal(error.count, 1);
    assert.equal(error.limit, 1);
    assert.match(error.message, /需要用户明确继续/);
    return true;
  });
  db.close();
});
