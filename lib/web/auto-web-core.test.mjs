import assert from 'node:assert/strict';
import test from 'node:test';
import { createAutoWebTools, runAutoWebChat } from './auto-web-core.mjs';

const searchResult = { context: '公开资料', provider: 'test', sources: [{ title: '资料', url: 'https://example.com/source' }], retrievedAt: '2026-10-16T00:00:00.000Z' };

test('no retrieval produces no label or attachments', async () => {
  const web = createAutoWebTools({ search: () => assert.fail('should not search') });
  const client = { chat: { completions: { create: async function* () { yield { choices: [{ delta: { content: '你好' } }] }; } } } };
  const deltas = [];
  assert.equal(await runAutoWebChat({ client, model: 'test', messages: [{ role: 'user', content: '你好' }], web, onText: (text) => deltas.push(text) }), '你好');
  assert.equal(deltas.join(''), '你好');
  assert.equal(web.footer(), '');
  assert.deepEqual(web.attachments(), []);
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
  assert.equal(answer, ' 到家啦，速度可以呀！');
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
