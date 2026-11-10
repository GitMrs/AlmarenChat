import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import {
  governPiModelRuntime,
  publicPiAssistantNote,
  runPiAgentSession,
  refreshPiActiveTools,
  visiblePiAssistantText,
} from './session-core.mjs';

test('Pi can activate a loaded tool without activating unregistered tools', () => {
  const active = ['capability_load'];
  const calls = [];
  const session = { setActiveToolsByName: (names) => calls.push(names) };
  const registered = [{ name: 'capability_load' }, { name: 'weather_query' }];
  refreshPiActiveTools(session, registered, () => active);
  active.push('weather_query', 'run_arbitrary_command');
  refreshPiActiveTools(session, registered, () => active);
  assert.deepEqual(calls, [['capability_load'], ['capability_load', 'weather_query']]);
});

test('Pi rejects an inactive tool then loads and calls it within the same turn', { timeout: 30_000 }, async () => {
  const requests = [];
  const failures = [];
  const server = createServer(async (request, response) => {
    try {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      requests.push(body);
      const round = requests.length;
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const tool = round === 1 || round === 3 ? 'weather_query' : round === 2 ? 'capability_load' : null;
      const delta = tool ? { tool_calls: [{ index: 0, id: `call-${round}`, type: 'function', function: { name: tool, arguments: '{}' } }] }
        : { content: '查询完成。' };
      response.write(`data: ${JSON.stringify({ id: `reply-${round}`, object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: `reply-${round}`, object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\n`);
      response.end('data: [DONE]\n\n');
    } catch (error) {
      failures.push(error);
      response.writeHead(500).end();
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const root = await mkdtemp(path.join(tmpdir(), 'pi-capability-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw Error('Pi must use the shared model transport'); };
  const active = ['capability_load'];
  let queries = 0;
  const result = (details) => ({ content: [{ type: 'text', text: JSON.stringify(details) }], details });
  try {
    const output = await runPiAgentSession({
      sessionKey: `test:${path.basename(root)}`,
      paths: { workspaceRoot: path.join(root, 'workspace'), runtimeRoot: path.join(root, 'runtime'), sessionDir: path.join(root, 'sessions') },
      apiBaseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      apiKey: 'local-test-key', modelName: 'local-capability-test', modelContextWindow: 32768,
      systemPrompt: '按工具结果回答。', message: '继续查刚才那个城市。', thinkingLevel: 'off',
      getActiveToolNames: () => active,
      tools: [
        defineTool({ name: 'capability_load', label: '加载', description: '加载查询工具', parameters: Type.Object({}), execute: async () => {
          active.push('weather_query');
          return result({ ok: true, loaded: true });
        } }),
        defineTool({ name: 'weather_query', label: '查询', description: '查询天气', parameters: Type.Object({}), execute: async () => {
          queries += 1;
          return result({ ok: true, temperature: 20 });
        } }),
      ],
    });
    assert.deepEqual(failures, []);
    assert.equal(requests.length, 4, JSON.stringify(output));
    assert.deepEqual(requests[0].tools.map((tool) => tool.function.name), ['capability_load']);
    assert.deepEqual(requests[1].tools.map((tool) => tool.function.name), ['capability_load']);
    assert.deepEqual(requests[2].tools.map((tool) => tool.function.name), ['capability_load', 'weather_query']);
    assert.equal(queries, 1);
    assert.equal(output.content, '查询完成。');
  } finally {
    globalThis.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('Pi Session Core reserves governance budget before every provider request', () => {
  const calls = [];
  const runtime = {
    streamSimple(model, context, options) {
      calls.push({ model, context, options });
      return 'stream';
    },
  };
  const reservations = [];
  const getRequestCount = governPiModelRuntime(runtime, {
    beforeModelRequest: ({ index }) => {
      reservations.push(index);
      if (index === 2) throw Object.assign(new Error('预算用尽'), { code: 'MODEL_REQUEST_BUDGET' });
      return { runCount: index };
    },
  });

  assert.equal(runtime.streamSimple({ id: 'model' }, { messages: [] }, { maxRetries: 4 }), 'stream');
  assert.equal(calls[0].options.maxRetries, 0);
  assert.throws(
    () => runtime.streamSimple({ id: 'model' }, { messages: [] }),
    (error) => error.code === 'MODEL_REQUEST_BUDGET'
  );
  assert.deepEqual(reservations, [1, 2]);
  assert.equal(calls.length, 1);
  assert.equal(getRequestCount(), 1);
});

test('Pi Session Core rejects asynchronous pre-request budget hooks', () => {
  const runtime = { streamSimple: () => 'stream' };
  governPiModelRuntime(runtime, { beforeModelRequest: async () => ({}) });
  assert.throws(() => runtime.streamSimple({}, {}), /必须同步完成/);
});

test('Pi Session Core rejects executions without a durable session identity', async () => {
  await assert.rejects(() => runPiAgentSession({}), /缺少 sessionKey/);
});

test('Pi Session Core keeps final text separate from pre-tool notes', () => {
  const toolTurn = {
    role: 'assistant',
    content: [
      { type: 'text', text: '准备执行 Bearer secret-token' },
      { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: {} },
    ],
  };
  assert.equal(visiblePiAssistantText(toolTurn), '');
  assert.equal(publicPiAssistantNote(toolTurn), '准备执行 Bearer [已隐藏]');
  assert.equal(visiblePiAssistantText({
    role: 'assistant',
    content: [{ type: 'text', text: '已经完成' }],
  }), '已经完成');
});
