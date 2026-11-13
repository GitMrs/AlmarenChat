import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createPiWorkerGovernance } from './pi-worker-governance.mjs';
import { RESPONSE_GROUNDING_GUIDANCE } from '../../lib/chat/conversation-grounding.mjs';

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
  assert.ok(options.systemPrompt.includes(RESPONSE_GROUNDING_GUIDANCE));
  assert.match(options.systemPrompt, /必须通过 submit_task_result 提交/);
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

test('Pi Worker capability help reflects actual task tools and cannot grant permissions', async () => {
  const build = createPiWorkerGovernance({ db: {}, reserveRequest: () => ({}) });
  const options = await build(request());
  const help = options.tools.find((tool) => tool.name === 'capability_help');
  assert.ok(help);
  const result = await help.execute('help-1', {});
  const capabilities = result.details.capabilities;
  assert.equal(capabilities.find((item) => item.id === 'web').status, '当前不可用');
  assert.equal(capabilities.find((item) => item.id === 'bilibili').status, '当前不可用');
  assert.equal(options.tools.some((tool) => tool.name === 'web_search'), false);
});

test('Pi Worker loads authorized research tools only when needed without performing a query', async () => {
  const build = createPiWorkerGovernance({ db: {}, reserveRequest: () => ({}) });
  let consumed = 0;
  const context = {
    ...request().context,
    authorization: { capabilities: ['web_research'], networkPolicy: 'allowed' },
    runtimePermissions: { consume: () => { consumed += 1; return { allowed: true }; } },
  };
  const options = await build(request({ context }));
  assert.equal(options.getActiveToolNames().includes('web_search'), false);
  assert.equal(options.getActiveToolNames().includes('capability_load'), true);
  const search = options.tools.find((tool) => tool.name === 'web_search');
  assert.equal((await search.execute('early', { query: 'test' })).isError, true);
  const help = options.tools.find((tool) => tool.name === 'capability_help');
  assert.equal((await help.execute('help', {})).details.capabilities.find((item) => item.id === 'web').status, '可按需使用');
  const loader = options.tools.find((tool) => tool.name === 'capability_load');
  assert.equal((await loader.execute('wrong', { capability: 'bilibili' })).isError, true);
  assert.equal(options.getActiveToolNames().includes('web_search'), false);
  await loader.execute('load', { capability: 'web' });
  await loader.execute('again', { capability: 'web' });
  assert.equal(consumed, 0);
  assert.equal(options.getActiveToolNames().filter((name) => name === 'web_search').length, 1);
  assert.equal(options.getActiveToolNames().includes('web_fetch'), true);
  assert.equal((await help.execute('loaded', {})).details.capabilities.find((item) => item.id === 'web').status, '本轮已加载');
  const explicit = await build(request({ context, task: { ...request().task, instruction: '搜索最新公开资料' } }));
  assert.equal(explicit.getActiveToolNames().includes('web_search'), true);
  const denied = await build(request());
  assert.equal(denied.tools.some((tool) => tool.name === 'capability_load'), false);
});

test('Pi Worker governance auto-recovers when valid artifacts were produced', async () => {
  const manifest = { entries: [{ path: 'article.md' }], validation: { valid: true } };
  const build = createPiWorkerGovernance({ db: {}, reserveRequest: () => ({}) });
  const options = await build(request({
    validateSubmission: async () => ({ ok: true, manifest }),
  }));
  const resolved = await options.resolveResult({ finalContent: '已自动写入文件', status: 'completed' });
  assert.equal(resolved, '已自动写入文件');
  assert.deepEqual(options.resolveExecutionResult(), {
    status: 'completed', paused: false, result: '已自动写入文件', manifest,
  });
});

test('Pi Worker governance lets advisor tasks return reviewed text without submit tool', async () => {
  const build = createPiWorkerGovernance({ db: {}, reserveRequest: () => ({}) });
  const options = await build(request({ mode: 'advisor' }));

  assert.ok(options.systemPrompt.includes(RESPONSE_GROUNDING_GUIDANCE));
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

test('Pi WeChat writing loads the selected method without the global search root', async () => {
  const build = createPiWorkerGovernance({ db: {}, reserveRequest: () => ({}) });
  const options = await build(request({
    workspaceOptions: { ...request().workspaceOptions, projectRoot: process.cwd() },
    context: { ...request().context, space: { workspaceType: 'WECHAT' }, authorization: { capabilities: ['workspace_read', 'workspace_write'] } },
    task: { ...request().task, title: '完成公众号短文', skillId: 'gzh-creator-suite' },
  }));
  assert.match(options.systemPrompt, /gzh-short-post\/SKILL.md/);
  assert.doesNotMatch(options.systemPrompt, /创作者的全域内容搜索与运营分析总控|单段严禁超 90 字/);
  assert.equal(options.tools.some((tool) => tool.name === 'run_skill'), false);
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

test('Pi Worker only exposes Bilibili tools for a related authorized task', async () => {
  const build = createPiWorkerGovernance({ db: {}, reserveRequest: () => ({}) });
  const bilibiliTools = {
    tools: [{
      type: 'function',
      function: { name: 'bilibili_search', description: '搜索 B 站', parameters: { type: 'object', properties: {} } },
    }],
    execute: async () => ({ ok: true }),
  };
  const baseContext = {
    model: { apiKey: 'key', baseURL: 'https://example.com/v1', name: 'model' },
    space: {}, bilibiliTools,
  };
  const unrelated = await build(request({ context: baseContext }));
  assert.equal(unrelated.tools.some((item) => item.name === 'bilibili_search'), false);
  const related = await build(request({
    context: baseContext,
    task: { ...request().task, instruction: '整理 Bilibili 视频资料' },
  }));
  assert.equal(related.tools.some((item) => item.name === 'bilibili_search'), true);
});

test('Pi Worker fetches public URLs after loading authorized research tools', async () => {
  const originalFetch = globalThis.fetch;
  const events = [];
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    headers: new Map(),
    text: async () => JSON.stringify({ url: String(url), items: [{ title: '示例' }] }),
  });
  try {
    const build = createPiWorkerGovernance({ db: {}, reserveRequest: () => ({}) });
    const options = await build(request({
      emit: (...args) => events.push(args),
      context: {
        model: { apiKey: 'key', baseURL: 'https://example.com/v1', name: 'model' },
        space: {},
        authorization: { capabilities: ['workspace_read', 'web_research'], networkPolicy: 'allowed' },
      },
    }));
    const tool = options.tools.find((item) => item.name === 'web_fetch');
    assert.ok(tool);
    await options.tools.find((item) => item.name === 'capability_load').execute('load-web', { capability: 'web' });
    const result = await tool.execute('fetch-1', { url: 'https://example.com/hot.json' });
    assert.equal(result.isError, false);
    assert.match(result.content[0].text, /示例/);
    assert.equal(events.some((event) => event[1] === 'WEB_FETCH_COMPLETED'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Pi Worker discovers and invokes an authorized remote MCP tool', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let connectorAllowed = true;
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
        authorizeMcpServer: async () => {
          if (!connectorAllowed) throw new Error('连接器已关闭');
          return { id: 'research', url: 'https://mcp.example.test/rpc' };
        },
      },
    }));
    const tool = options.tools.find((item) => item.name === 'mcp_research_lookup');
    assert.ok(tool);
    assert.equal(options.getActiveToolNames().includes('mcp_research_lookup'), false);
    assert.equal((await tool.execute('hidden-call', { q: 'agent' })).isError, true);
    assert.deepEqual(calls, ['tools/list']);
    const loader = options.tools.find((item) => item.name === 'mcp_load');
    assert.equal((await loader.execute('denied-load', { serverId: 'not-authorized' })).isError, true);
    await loader.execute('load-call', { serverId: 'research' });
    assert.equal(options.getActiveToolNames().includes('mcp_research_lookup'), true);
    const result = await tool.execute('mcp-call', { q: 'agent' });
    assert.equal(result.isError, false);
    assert.deepEqual(calls, ['tools/list', 'tools/call']);
    assert.equal(events.some((event) => event[1] === 'MCP_TOOL_COMPLETED'), true);
    connectorAllowed = false;
    assert.equal((await tool.execute('revoked-call', { q: 'agent' })).isError, true);
    assert.deepEqual(calls, ['tools/list', 'tools/call']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Pi worker forwards reasoning and correlated tool lifecycle events', async () => {
  const events = [];
  const build = createPiWorkerGovernance({ db: {}, reserveRequest: () => ({}) });
  const options = await build(request({ emit: (...event) => events.push(event) }));
  options.onReasoningStart();
  options.onReasoningDelta('核对文件');
  options.onReasoningComplete();
  options.onToolEvent({ type: 'start', id: 'call-1', name: 'read_file', args: { path: 'article.md' } });
  options.onToolEvent({ type: 'end', id: 'call-1', name: 'read_file', isError: false, result: { details: { ok: false, error: '不存在' } } });
  assert.equal(events[1][3].final, true);
  assert.equal(events[2][1], 'TOOL_STARTED');
  assert.equal(events[3][1], 'TOOL_FINISHED');
  assert.equal(events[3][3].toolCallId, 'call-1');
  assert.equal(events[3][3].path, 'article.md');
  assert.equal(events[3][3].failed, true);
});

test('Pi MCP discovery and calls require current network consent and share the web budget', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.method);
    return { ok: true, json: async () => ({ result: body.method === 'tools/list'
      ? { tools: [{ name: 'lookup', inputSchema: { type: 'object' } }] } : { ok: true } }) };
  };
  try {
    const build = createPiWorkerGovernance({ db: {}, reserveRequest: () => ({}) });
    const makeContext = decision => ({
      model: { apiKey: 'key', baseURL: 'https://example.com/v1', name: 'model' }, space: {},
      authorization: { capabilities: ['workspace_read', 'web_research'], networkPolicy: 'runtime', networkDecision: decision },
      mcpServers: [{ id: 'docs', url: 'https://example.test/mcp' }],
    });
    for (const decision of ['pending', 'denied']) {
      const options = await build(request({ context: makeContext(decision) }));
      assert.equal(options.tools.some(tool => tool.name.startsWith('mcp_')), false);
    }
    assert.deepEqual(calls, []);
    const context = makeContext('allowed');
    const options = await build(request({ context }));
    const loader = options.tools.find(tool => tool.name === 'mcp_load');
    const tool = options.tools.find(tool => tool.name === 'mcp_docs_lookup');
    await loader.execute('load', { serverId: 'docs' });
    for (const decision of ['pending', 'denied']) {
      context.authorization.networkDecision = decision;
      assert.equal((await loader.execute('blocked-load', { serverId: 'docs' })).isError, true);
      assert.equal((await tool.execute('blocked-call', {})).isError, true);
    }
    assert.deepEqual(calls, ['tools/list']);
    context.authorization.networkDecision = 'allowed';
    context.runtimePermissions.consume('web_research', 'web_search');
    assert.equal((await tool.execute('allowed-call', {})).isError, false);
    assert.equal((await tool.execute('over-budget', {})).isError, true);
    assert.deepEqual(calls, ['tools/list', 'tools/call']);
  } finally { globalThis.fetch = originalFetch; }
});
