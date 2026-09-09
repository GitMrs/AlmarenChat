import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createPiWorkerGovernance } from './pi-worker-governance.mjs';

function request(overrides = {}) {
  return {
    mode: 'executor',
    run: { id: 'run-1', input: '创建文章' },
    task: { id: 'task-1', attempt: 2, title: '撰写', instruction: '创建 article.md' },
    agent: { id: 'agent-1', name: '编辑' },
    context: { model: { apiKey: 'key', baseURL: 'https://example.com/v1', name: 'model' }, space: {} },
    workspaceOptions: { projectRoot: '/tmp/almaren-pi-test', userId: 'user-1', spaceId: 'space-1', taskId: 'task-1', attempt: 2 },
    isCancelled: () => false,
    ...overrides,
  };
}

test('Pi Worker governance binds durable task identity and reserves budget before calls', async () => {
  const reservations = [];
  const build = createPiWorkerGovernance({
    db: {},
    now: () => '2026-09-08T00:00:00.000Z',
    reserveRequest: (_db, runId, taskId, timestamp) => {
      reservations.push({ runId, taskId, timestamp });
      return { runCount: 3, taskCount: 2 };
    },
  });
  const options = await build(request());

  assert.equal(options.sessionKey, 'task:run-1:task-1:2');
  assert.match(options.paths.workspaceRoot, /staging[\\/]task-1[\\/]2[\\/]workspace$/);
  assert.equal(path.basename(options.paths.sessionDir), '2');
  assert.deepEqual(options.beforeModelRequest({ index: 1 }), { runCount: 3, taskCount: 2 });
  assert.deepEqual(reservations, [{ runId: 'run-1', taskId: 'task-1', timestamp: '2026-09-08T00:00:00.000Z' }]);
});

test('Pi Worker governance pauses on user input and stops the Pi turn', async () => {
  let pausedWith = null;
  const build = createPiWorkerGovernance({ db: {}, reserveRequest: () => ({}) });
  const options = await build(request({
    pauseForInput: (args) => { pausedWith = args; return { paused: true }; },
  }));
  const tool = options.tools.find((item) => item.name === 'request_user_input');
  const result = await tool.execute('call-1', { question: '目标读者是谁？', reason: '无法确定语气' });

  assert.deepEqual(pausedWith, { question: '目标读者是谁？', reason: '无法确定语气' });
  assert.equal(result.isError, false);
  assert.equal(options.shouldStopAfterTurn(), true);
  assert.deepEqual(options.resolveExecutionResult(), {
    status: 'waiting', paused: true, result: '', manifest: null,
  });
});

test('Pi Worker governance accepts only validated structured completion', async () => {
  const manifest = { entries: [{ path: 'article.md' }], validation: { valid: true } };
  const build = createPiWorkerGovernance({ db: {}, reserveRequest: () => ({}) });
  const options = await build(request({
    validateSubmission: async () => ({ ok: true, manifest }),
  }));
  const tool = options.tools.find((item) => item.name === 'submit_task_result');
  const result = await tool.execute('call-2', { summary: '文章已经完成', remainingIssues: [] });

  assert.equal(result.isError, false);
  assert.equal(options.shouldStopAfterTurn(), true);
  assert.equal(options.resolveResult({ finalContent: '', status: 'completed' }), '文章已经完成');
  assert.deepEqual(options.resolveExecutionResult(), {
    status: 'completed', paused: false, result: '文章已经完成', manifest,
  });
});

test('Pi Worker governance rejects an unstructured executor ending', async () => {
  const build = createPiWorkerGovernance({ db: {}, reserveRequest: () => ({}) });
  const options = await build(request());
  assert.throws(
    () => options.resolveResult({ finalContent: '我做完了', status: 'completed' }),
    /没有通过 submit_task_result/
  );
});

test('Pi Worker governance lets advisor tasks return reviewed text without submit tool', async () => {
  const build = createPiWorkerGovernance({ db: {}, reserveRequest: () => ({}) });
  const options = await build(request({ mode: 'advisor' }));

  assert.equal(options.tools.some((item) => item.name === 'submit_task_result'), false);
  assert.equal(options.resolveResult({ finalContent: '风险结论', status: 'completed' }), '风险结论');
  assert.equal(options.resolveExecutionResult().result, undefined);
});

test('Pi Worker governance preserves cancellation from the Pi Session', async () => {
  const build = createPiWorkerGovernance({ db: {}, reserveRequest: () => ({}) });
  const options = await build(request());
  assert.equal(options.resolveExecutionResult({ execution: { status: 'cancelled' } }).status, 'cancelled');
});

test('Pi Worker governance emits model token telemetry through Worker events', async () => {
  const events = [];
  const build = createPiWorkerGovernance({ db: {}, reserveRequest: () => ({}) });
  const options = await build(request({ emit: (...args) => events.push(args) }));
  options.onModelRequestComplete({
    index: 2,
    durationMs: 90,
    requestChars: 1200,
    estimatedInputTokens: 300,
    estimatedOutputTokens: 80,
    finishReasons: ['toolUse'],
    toolCallCount: 1,
    providerUsage: { input: 300, output: 80 },
  });

  assert.equal(events[0][1], 'MODEL_REQUEST_COMPLETED');
  assert.equal(events[0][3].estimatedTotalTokens, 380);
  assert.equal(events[0][3].engine, 'pi');
});

test('Pi Worker governance exposes only Skill and authorization approved workspace tools', async () => {
  const build = createPiWorkerGovernance({ db: {}, reserveRequest: () => ({}) });
  const options = await build(request({
    context: {
      model: { apiKey: 'key', baseURL: 'https://example.com/v1', name: 'model' },
      space: {},
      authorization: { capabilities: ['workspace_read', 'workspace_write'] },
    },
    task: {
      id: 'task-1',
      attempt: 1,
      instruction: '创建 article.md',
      skillSnapshot: {
        id: 'document-writer',
        name: 'Markdown 文档编写',
        version: '1',
        allowedTools: ['list_files', 'read_file', 'check_files', 'write_file', 'patch_file', 'patch_files'],
      },
    },
  }));
  const names = options.tools.map((item) => item.name);

  assert.equal(names.includes('write_file'), true);
  assert.equal(names.includes('patch_files'), true);
  assert.equal(names.includes('run_check'), false);
  assert.equal(names.includes('submit_task_result'), true);
});
