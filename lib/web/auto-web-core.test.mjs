import assert from 'node:assert/strict';
import test from 'node:test';
import { createAutoWebTools, runAutoWebChat } from './auto-web-core.mjs';
import { createChatDataTools } from '../chat/chat-data-tools.mjs';

const searchResult = { context: '公开资料', provider: 'test', sources: [{ title: '资料', url: 'https://example.com/source' }], retrievedAt: '2026-10-16T00:00:00.000Z' };

test('connector pagination can exceed six rounds and ends with a tool-free partial summary at its budget', async () => {
  let requests = 0, calls = 0;
  const client = { chat: { completions: { create: async function* (body) {
    requests++;
    if (body.tool_choice === 'none') {
      assert.deepEqual(body.tools, []);
      assert.equal(body.messages.filter(message => message.role === 'tool').length, 12);
      assert.match(body.messages.at(-1).content, /未执行|未读取/);
      yield { choices: [{ delta: { content: '已读取12页，后续分页尚未读取。' } }] };
    } else yield { choices: [{ delta: { tool_calls: [{ index: 0, id: `page-${requests}`, type: 'function', function: { name: 'mcp_office_messages', arguments: JSON.stringify({ page: requests }) } }] } }] };
  } } } };
  const result = await runAutoWebChat({ client, model: 'test', messages: [{ role: 'user', content: '读取几个群的消息' }], web: createAutoWebTools({ availableToolNames: [] }),
    extraTools: [{ type: 'function', function: { name: 'mcp_load' } }], callTool: async () => { calls++; return { code: 0, messages: ['message'], has_more: true }; } });
  assert.equal(calls, 12);
  assert.equal(requests, 13);
  assert.match(result, /尚未读取/);
});

test('connector call limit closes unexecuted batch calls before finalization and never retries writes', async () => {
  let calls = 0;
  const client = { chat: { completions: { create: async function* (body) {
    if (body.tool_choice === 'none') {
      const results = body.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content));
      assert.equal(results.length, 26);
      assert.equal(results.filter(result => result.skipped).length, 2);
      yield { choices: [{ delta: { content: '24项已执行，另外2项未执行。' } }] };
    } else yield { choices: [{ delta: { tool_calls: Array.from({ length: 26 }, (_, i) => ({ index: i, id: `write-${i}`, type: 'function', function: { name: 'mcp_office_send', arguments: JSON.stringify({ id: i }) } })) } }] };
  } } } };
  const result = await runAutoWebChat({ client, model: 'test', messages: [], web: createAutoWebTools({ availableToolNames: [] }), extraTools: [{ type: 'function', function: { name: 'mcp_load' } }], callTool: async () => { calls++; return { ok: true }; } });
  assert.equal(calls, 24);
  assert.match(result, /2项未执行/);
});

test('repeated connector calls stop with existing evidence instead of increasing the budget indefinitely', async () => {
  let calls = 0;
  const client = { chat: { completions: { create: async function* (body) {
    if (body.tool_choice === 'none') yield { choices: [{ delta: { content: '重复查询未取得新进展，已停止。' } }] };
    else yield { choices: [{ delta: { tool_calls: [{ index: 0, id: `repeat-${calls}`, type: 'function', function: { name: 'mcp_office_help', arguments: '{}' } }] } }] };
  } } } };
  const result = await runAutoWebChat({ client, model: 'test', messages: [], web: createAutoWebTools({ availableToolNames: [] }), extraTools: [{ type: 'function', function: { name: 'mcp_load' } }], callTool: async () => { calls++; return { ok: true }; } });
  assert.equal(calls, 2);
  assert.match(result, /停止/);
});

test('connector context overflow is not mistaken for a tool limit or retried for a summary', async () => {
  let requests = 0;
  const client = { chat: { completions: { create: async function* () {
    requests++;
    yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'large-read', type: 'function', function: { name: 'mcp_office_read', arguments: '{}' } }] } }] };
  } } } };
  await assert.rejects(runAutoWebChat({ client, model: 'test', messages: [], web: createAutoWebTools({ availableToolNames: [] }), contextBudget: 2500,
    extraTools: [{ type: 'function', function: { name: 'mcp_load' } }], callTool: async () => ({ content: '长'.repeat(20000) }),
  }), /超出上下文预算/);
  assert.equal(requests, 1);
});

test('available tool names keep unrequested external tools out of the model schema', () => {
  const dataTool = { schema: { type: 'function', function: { name: 'weather_query' } }, execute: async () => ({}) };
  const web = createAutoWebTools({
    search: async () => searchResult,
    fetchPage: async () => ({ url: 'https://example.com/source', content: '正文' }),
    dataTools: [dataTool],
    availableToolNames: ['weather_query'],
  });
  assert.deepEqual(web.tools.map(tool => tool.function.name), ['weather_query']);
});

test('idle chat sends less schema than the previous eager external tool pool', () => {
  const dataTools = createChatDataTools({ weather: {}, trending: async () => ({}), crypto: async () => ({}) });
  const eager = createAutoWebTools({ dataTools });
  const idle = createAutoWebTools({ dataTools, availableToolNames: [], loadableCapabilities: ['web', 'weather', 'trending', 'crypto'] });
  assert.equal(eager.tools.length, 6);
  assert.deepEqual(idle.tools.map((tool) => tool.function.name), ['capability_load']);
  assert.ok(JSON.stringify(idle.tools).length < JSON.stringify(eager.tools).length);
});

test('model can load a permitted capability then query it within the same conversation', async () => {
  let queryCalls = 0;
  const web = createAutoWebTools({
    availableToolNames: [],
    loadableCapabilities: ['weather'],
    dataTools: [{
      schema: { type: 'function', function: { name: 'weather_query', parameters: { type: 'object' } } },
      execute: async () => { queryCalls += 1; return { ok: true, status: 'success', temperature: 20 }; },
    }],
  });
  let round = 0;
  const observed = [];
  const client = { chat: { completions: { create: async function* (body) {
    observed.push(body.tools.map((tool) => tool.function.name));
    round += 1;
    if (round === 1 || round === 2) {
      const name = round === 1 ? 'capability_load' : 'weather_query';
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${round}`, type: 'function', function: {
        name, arguments: round === 1 ? '{"capability":"weather"}' : '{"location":"北京"}',
      } }] } }] };
    } else yield { choices: [{ delta: { content: '查询结果为20度。' } }] };
  } } } };
  await runAutoWebChat({ client, model: 'test', messages: [{ role: 'user', content: '接着查刚才那个城市吧' }], web });
  assert.deepEqual(observed[0], ['capability_load']);
  assert.deepEqual(observed[1], ['capability_load', 'weather_query']);
  assert.equal(queryCalls, 1);
  assert.equal(web.attachments()[0].records.length, 1);
});

test('capability loading is idempotent and cannot grant unlisted or account tools', async () => {
  const web = createAutoWebTools({ availableToolNames: [], loadableCapabilities: ['web', 'bilibili'] });
  assert.equal((await web.execute('capability_load', { capability: 'bilibili' })).ok, false);
  assert.equal((await web.execute('capability_load', { capability: 'weather' })).ok, false);
  await assert.rejects(web.execute('web_search', { query: 'hidden' }), /未知联网工具/);
  await web.execute('capability_load', { capability: 'web' });
  await web.execute('capability_load', { capability: 'web' });
  assert.equal(web.tools.filter((tool) => tool.function.name === 'web_search').length, 1);
});

test('no retrieval produces no label or attachments', async () => {
  const web = createAutoWebTools({ search: () => assert.fail('should not search') });
  const client = { chat: { completions: { create: async function* () { yield { choices: [{ delta: { content: '你好' } }] }; } } } };
  const deltas = [];
  assert.equal(await runAutoWebChat({ client, model: 'test', messages: [{ role: 'user', content: '你好' }], web, onText: (text) => deltas.push(text) }), '你好');
  assert.equal(deltas.join(''), '你好');
  assert.equal(web.footer(), '');
  assert.deepEqual(web.attachments(), []);
});

test('context usage reports the exact tool schema sent to the model', async () => {
  const web = createAutoWebTools({
    dataTools: [{ schema: { type: 'function', function: { name: 'weather_query', parameters: { type: 'object' } } }, execute: async () => ({}) }],
    availableToolNames: ['weather_query'],
  });
  let usage = null;
  const client = { chat: { completions: { create: async function* () { yield { choices: [{ delta: { content: '天气不错' } }] }; } } } };
  await runAutoWebChat({
    client,
    model: 'test',
    messages: [{ role: 'user', content: '今天怎么样' }],
    web,
    onContextUsage: (value) => { usage = value; },
  });
  assert.equal(usage.toolCount, 1);
  assert.deepEqual(usage.toolNames, ['weather_query']);
  assert.equal(usage.toolSchemaChars, JSON.stringify(web.tools).length);
});

test('leading history timestamp metadata is removed from streamed model text', async () => {
  const web = createAutoWebTools();
  const client = { chat: { completions: { create: async function* () {
    for (const content of ['[历史消息时间：2026-10-29 16:52，北京时间]\n', '去吧去吧！']) {
      yield { choices: [{ delta: { content } }] };
    }
  } } } };
  const deltas = [];
  const answer = await runAutoWebChat({ client, model: 'test', messages: [{ role: 'user', content: '继续' }], web, onText: text => deltas.push(text) });
  assert.equal(answer, '去吧去吧！');
  assert.equal(deltas.join(''), '去吧去吧！');
});

test('leading history timestamp metadata is removed even after a streamed leading newline', async () => {
  const web = createAutoWebTools();
  const client = { chat: { completions: { create: async function* () {
    for (const content of ['\n[历史消息时间：2026-10-29 18:53，北京时间] 到家啦', '，速度可以呀！']) {
      yield { choices: [{ delta: { content } }] };
    }
  } } } };
  const answer = await runAutoWebChat({ client, model: 'test', messages: [{ role: 'user', content: '我到家了' }], web });
  assert.equal(answer, '到家啦，速度可以呀！');
});

test('history timestamp variants are removed from streamed reply text', async () => {
  const web = createAutoWebTools();
  const client = { chat: { completions: { create: async function* () {
    yield { choices: [{ delta: { content: '我记得【历史消息时间: 2026/10/29 18:53:00 北京时间】你到家了。' } }] };
  } } } };
  const answer = await runAutoWebChat({ client, model: 'test', messages: [{ role: 'user', content: '继续' }], web });
  assert.equal(answer, '我记得你到家了。');
});

test('reasoning across tool rounds reaches its own callback and stays out of model history', async () => {
  let requests = 0;
  const web = createAutoWebTools({ search: async () => searchResult });
  const client = { chat: { completions: { create: async function* (request) {
    assert.doesNotMatch(JSON.stringify(request.messages), /先查资料|再整理/);
    if (requests++ === 0) {
      yield { choices: [{ delta: { reasoning_content: '先查资料' } }] };
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'search', type: 'function', function: { name: 'web_search', arguments: '{"query":"主题"}' } }] } }] };
    } else {
      yield { choices: [{ delta: { reasoning_content: '再整理', content: '结果。' } }] };
    }
  } } } };
  const reasoning = [];
  const text = [];
  const answer = await runAutoWebChat({ client, model: 'test', messages: [{ role: 'user', content: '查资料' }], web, onReasoning: delta => reasoning.push(delta), onText: delta => text.push(delta) });
  assert.deepEqual(reasoning, ['先查资料', '再整理']);
  assert.equal(answer, text.join(''));
  assert.doesNotMatch(answer, /先查资料|再整理/);
  assert.equal(requests, 2);
});

test('search and fetch share a budget, reuse successful results and deduplicate sources', async () => {
  let searches = 0;
  const web = createAutoWebTools({
    search: async () => { searches += 1; return searchResult; },
    fetchPage: async () => ({ url: 'https://example.com/source', content: '正文' }),
    limit: 2,
  });
  await web.execute('web_search', { query: '主题' });
  await web.execute('web_search', { query: '主题' });
  await web.execute('web_fetch', { url: 'https://example.com/source' });
  assert.equal((await web.execute('web_search', { query: '其他主题' })).ok, false);
  assert.equal(searches, 1);
  assert.equal(web.attachments()[0].records.length, 2);
  assert.equal((web.footer().match(/https:\/\/example.com\/source/g) || []).length, 1);
});

test('failed and empty searches never create a successful source', async () => {
  const web = createAutoWebTools({ search: async () => { throw new Error('secret provider error'); } });
  const result = await web.execute('web_search', { query: '主题' });
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
  assert.match(web.footer(), /查询失败/);
  assert.doesNotMatch(web.footer(), /\*\*查询来源/);
  const empty = createAutoWebTools({ search: async () => ({ context: '无结果', sources: [] }) });
  await empty.execute('web_search', { query: '不存在' });
  assert.equal(empty.attachments()[0].records[0].status, 'empty');
  assert.doesNotMatch(empty.footer(), /\*\*查询来源/);
});

test('timeout prevents late results from becoming evidence', async () => {
  let finish;
  const web = createAutoWebTools({ search: () => new Promise((resolve) => { finish = resolve; }), timeoutMs: 5 });
  assert.equal((await web.execute('web_search', { query: '主题' })).ok, false);
  finish(searchResult);
  await Promise.resolve();
  assert.equal(web.attachments()[0].records[0].status, 'failed');
  assert.doesNotMatch(web.footer(), /example.com/);
});

test('user cancellation aborts tool work and prevents further requests', async () => {
  const controller = new AbortController();
  let querySignal;
  const web = createAutoWebTools({ signal: controller.signal, search: async (_query, signal) => { querySignal = signal; return new Promise(() => {}); } });
  const pending = web.execute('web_search', { query: '主题' });
  controller.abort();
  await assert.rejects(pending);
  assert.equal(querySignal.aborted, true);
  await assert.rejects(web.execute('web_search', { query: '不能再搜索' }));
  assert.deepEqual(web.attachments(), []);
});

test('streaming tool loop preserves MCP tools and appends only actual web evidence', async () => {
  let requests = 0;
  const called = [];
  const web = createAutoWebTools({ search: async () => searchResult });
  const client = { chat: { completions: { create: async function* (request) {
    requests += 1;
    assert.ok(request.tools.some((tool) => tool.function.name === 'account_tool'));
    if (requests === 1) {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'search1', type: 'function', function: { name: 'web_search', arguments: '{"query":"主题"}' } }] } }] };
    } else if (requests === 2) {
      assert.ok(request.messages.some((message) => message.role === 'tool' && message.content.includes('example.com/source')));
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'account1', type: 'function', function: { name: 'account_tool', arguments: '{}' } }] } }] };
    } else {
      yield { choices: [{ delta: { content: '依据资料回答。' } }] };
    }
  } } } };
  const deltas = [];
  const answer = await runAutoWebChat({ client, model: 'test', messages: [{ role: 'user', content: '查资料' }], web, extraTools: [{ type: 'function', function: { name: 'account_tool', parameters: { type: 'object' } } }], callTool: async (name) => { called.push(name); return { ok: true }; }, onText: (text) => deltas.push(text) });
  assert.equal(requests, 3);
  assert.deepEqual(called, ['account_tool']);
  assert.equal(answer, deltas.join(''));
  assert.match(answer, /依据资料回答。[\s\S]*查询来源[\s\S]*https:\/\/example.com\/source/);
});

test('complete request budget counts tool results before the next model request', async () => {
  let modelCalls = 0;
  let toolCalls = 0;
  const client = { chat: { completions: { create: async function* () {
    modelCalls++;
    yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'budget-read', type: 'function', function: { name: 'memory_read', arguments: '{"archiveId":"a"}' } }] } }] };
  } } } };
  await assert.rejects(runAutoWebChat({
    client, model: 'fixture', messages: [{ role: 'user', content: '核对原文' }], web: createAutoWebTools(), contextBudget: 2500,
    extraTools: [{ type: 'function', function: { name: 'memory_read', parameters: { type: 'object' } } }],
    callTool: async () => { toolCalls++; return { content: '长'.repeat(10000) }; },
  }), /超出上下文预算/);
  assert.equal(modelCalls, 1);
  assert.equal(toolCalls, 1);
});
