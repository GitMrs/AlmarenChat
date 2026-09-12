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

test('Pi Worker exposes real Skill package scripts only after code execution authorization', async () => {
  const build = createPiWorkerGovernance({ db: {}, reserveRequest: () => ({}) });
  const baseTask = {
    id: 'task-1', attempt: 1, title: '查询公众号趋势', instruction: '使用 Skill 脚本获取趋势',
    skillSnapshot: {
      id: 'gzh-creator-suite', name: '公众号爆款创作套件', version: '1', packagePath: 'creator-buddy-main',
      allowedTools: ['list_files', 'read_file', 'check_files', 'run_skill'],
    },
  };
  const authorized = await build(request({
    workspaceOptions: { ...request().workspaceOptions, projectRoot: process.cwd() },
    context: { model: { apiKey: 'key', baseURL: 'https://example.com/v1', name: 'model' }, space: {}, authorization: { capabilities: ['workspace_read', 'workspace_write', 'code_execute'] } },
    task: baseTask,
  }));
  assert.equal(authorized.tools.some((item) => item.name === 'run_skill'), true);

  const denied = await build(request({
    workspaceOptions: { ...request().workspaceOptions, projectRoot: process.cwd() },
    context: { model: { apiKey: 'key', baseURL: 'https://example.com/v1', name: 'model' }, space: {}, authorization: { capabilities: ['workspace_read', 'workspace_write'] } },
    task: baseTask,
  }));
  assert.equal(denied.tools.some((item) => item.name === 'run_skill'), false);
});

test('Pi Worker requests one-time Skill script permission through the existing wait flow', async () => {
  let paused = null;
  const build = createPiWorkerGovernance({ db: {}, reserveRequest: () => ({}) });
  const options = await build(request({
    workspaceOptions: { ...request().workspaceOptions, projectRoot: process.cwd() },
    pauseForInput: (value) => { paused = value; return { paused: true }; },
    context: { model: { apiKey: 'key', baseURL: 'https://example.com/v1', name: 'model' }, space: {}, authorization: { capabilities: ['workspace_read', 'workspace_write'] } },
    task: {
      id: 'task-1', attempt: 1, title: '查询公众号趋势', instruction: '需要脚本', waitAnswer: '',
      skillSnapshot: { id: 'gzh-creator-suite', name: '公众号爆款创作套件', version: '1', packagePath: 'creator-buddy-main', allowedTools: ['list_files', 'read_file', 'check_files', 'run_skill'] },
    },
  }));
  const permissionTool = options.tools.find((item) => item.name === 'request_skill_permission');
  assert.ok(permissionTool);
  const result = await permissionTool.execute('call-permission', { script: 'gzh-Skills/gzh-explosive-content-detector/scripts/fetch_gzh_trends.py', reason: '需要运行数据采集入口' });
  assert.equal(result.isError, false);
  assert.equal(options.shouldStopAfterTurn(), true);
  assert.match(paused.question, /允许本次 Skill 脚本执行/);
});

test('Pi Worker exposes controlled web search only with web research authorization', async () => {
  const build = createPiWorkerGovernance({ db: {}, reserveRequest: () => ({}) });
  const authorized = await build(request({
    context: { model: { apiKey: 'key', baseURL: 'https://example.com/v1', name: 'model' }, space: {}, authorization: { capabilities: ['workspace_read', 'web_research'], networkPolicy: 'allowed' }, tavilyApiKey: null },
  }));
  assert.equal(authorized.tools.some((item) => item.name === 'web_search'), true);
  const denied = await build(request({
    context: { model: { apiKey: 'key', baseURL: 'https://example.com/v1', name: 'model' }, space: {}, authorization: { capabilities: ['workspace_read'], networkPolicy: 'forbidden' } },
  }));
  assert.equal(denied.tools.some((item) => item.name === 'web_search'), false);
});

test('Pi Worker discovers and invokes an authorized remote MCP tool', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.method);
    return {
      ok: true,
      json: async () => ({ result: body.method === 'tools/list'
        ? { tools: [{ name: 'lookup', description: '查询资料', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }] }
        : { content: [{ type: 'text', text: 'mcp result' }] } }),
    };
  };
  try {
    const events = [];
    const build = createPiWorkerGovernance({ db: {}, reserveRequest: () => ({}) });
    const options = await build(request({
      emit: (...args) => events.push(args),
      context: {
        model: { apiKey: 'key', baseURL: 'https://example.com/v1', name: 'model' }, space: {},
        authorization: { capabilities: ['workspace_read', 'web_research'], networkPolicy: 'allowed' },
        mcpServers: [{ id: 'research', url: 'https://mcp.example.test/rpc' }],
      },
    }));
    const tool = options.tools.find((item) => item.name === 'mcp_research_lookup');
    assert.ok(tool);
    const result = await tool.execute('mcp-call', { q: 'agent' });
    assert.equal(result.isError, false);
    assert.deepEqual(calls, ['tools/list', 'tools/call']);
    assert.equal(events.some((event) => event[1] === 'MCP_TOOL_COMPLETED'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
