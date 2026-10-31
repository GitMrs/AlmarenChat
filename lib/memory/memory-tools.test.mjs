import { createAutoWebTools, runAutoWebChat } from '../web/auto-web-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as recall from './memory-recall.mjs';

async function load(file, modules) {
  const compiled = ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, console, require(name) { if (!(name in modules)) throw new Error(name); return modules[name]; } });
  return exports;
}
function match(row, where) {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(item => match(row, item));
    if (key === 'OR') return value.some(item => match(row, item));
    if (value && typeof value === 'object') return Object.entries(value).every(([op, x]) => op === 'in' ? x.includes(row[key]) : op === 'notIn' ? !x.includes(row[key]) : op === 'contains' ? String(row[key] || '').includes(x) : op === 'startsWith' ? String(row[key] || '').startsWith(x) : op === 'gte' ? new Date(row[key]) >= new Date(x) : op === 'lt' ? new Date(row[key]) < new Date(x) : op === 'equals' ? row[key] === x : true);
    return row[key] === value;
  });
}
async function fixture() {
  const chats = [
    { id: 'assistant-chat', userId: 'u', kind: 'PERSONAL_ASSISTANT', assistantMode: 'MAIN' },
    { id: 'agent-chat', userId: 'u', kind: 'AGENT', agentId: 'a', agentMode: 'MAIN' },
    { id: 'temp', userId: 'u', kind: 'AGENT', agentId: 'a', agentMode: 'TEMPORARY' },
  ];
  const date = new Date('2026-10-30T12:00:00Z');
  const rows = [
    ...Array.from({ length: 130 }, (_, i) => ({ id: `recent-${i}`, userId: 'u', conversationId: 'assistant-chat', summary: '- 用户说了其他话。', startAt: date, endAt: date })),
    { id: 'old', userId: 'u', conversationId: 'assistant-chat', summary: '- 用户明确预约手机维修11点。', startAt: date, endAt: date },
  ];
  const agents = [{ id: 'agent-old', userId: 'u', agentId: 'a', sourceType: 'CHAT', taskId: 'chat:agent-chat:last', outcome: 'ACCEPTED', status: 'ACTIVE', summary: rows.at(-1).summary, createdAt: date, tags: ['message:one', 'message:foreign', 'message:two'] }];
  const messages = [
    { id: 'one', conversationId: 'agent-chat', role: 'user', content: '手机维修约11点，159元。', createdAt: date },
    { id: 'foreign', conversationId: 'other-chat', role: 'user', content: '别人的秘密', createdAt: date },
    { id: 'two', conversationId: 'agent-chat', role: 'assistant', content: '原话'.repeat(2000), createdAt: date },
    ...Array.from({ length: 10 }, (_, i) => ({ id: `raw-${i}`, conversationId: 'assistant-chat', assistantExperienceId: 'old', role: 'user', content: '用户当时原话' + i, createdAt: date })),
  ];
  const query = data => ({ findFirst: async ({ where }) => data.find(row => match(row, where)) || null, findMany: async ({ where, skip = 0, take }) => data.filter(row => match(row, where)).slice(skip, skip + take) });
  const db = { conversation: query(chats), assistantExperience: query(rows), agentExperience: query(agents), message: query(messages) };
  const store = await load('./memory-store.ts', { '@/app/api/_lib/db': { default: db }, './memory-recall.mjs': recall });
  const tools = await load('./memory-tools.ts', { './memory-store': store });
  return { store, tools, agents, rows, messages, scope: { userId: 'u', kind: 'agent', agentId: 'a', conversationId: 'agent-chat' }, assistant: { userId: 'u', kind: 'assistant', conversationId: 'assistant-chat' } };
}

test('search finds older matching archives before limiting recent candidates', async () => {
  const f = await fixture();
  const result = await f.store.searchMemoryArchives(f.assistant, '还记得手机维修吗');
  assert.deepEqual([...result.items].map(item => item.id), ['old']);
  assert.match(result.context, /手机维修11点/);
  assert.equal((await f.store.searchMemoryArchives(f.scope, '手机维修')).items[0].id, 'agent-old');
});

test('archive and original message reads enforce user, role, conversation, mode and active state', async () => {
  const f = await fixture();
  for (const scope of [{ ...f.scope, userId: 'other' }, { ...f.scope, agentId: 'b' }, { ...f.scope, conversationId: 'temp' }, { ...f.scope, conversationId: 'other' }]) {
    await assert.rejects(f.store.readMemoryArchive(scope, { archiveId: 'agent-old' }), /无权/);
  }
  await assert.rejects(f.store.readMemoryArchive(f.scope, { archiveId: 'old' }), /不存在/);
  let result = await f.store.readMemoryArchive(f.scope, { archiveId: 'agent-old' });
  assert.deepEqual([...result.messages].map(item => item.id), ['one', 'two']);
  assert.doesNotMatch(JSON.stringify(result), /别人的秘密/);
  assert.equal(result.messages[1].content.length, 1200);
  assert.equal(result.messages[1].nextContentOffset, 1200);
  result = await f.store.readMemoryArchive(f.scope, { archiveId: 'agent-old', messageId: 'two', contentOffset: 1200 });
  assert.equal(result.messages[0].contentOffset, 1200);
  f.agents[0].status = 'DISABLED';
  await assert.rejects(f.store.readMemoryArchive(f.scope, { archiveId: 'agent-old' }), /不存在/);
});

test('raw reads paginate, exclude current context and report missing legacy sources', async () => {
  const f = await fixture();
  const page = await f.store.readMemoryArchive(f.assistant, { archiveId: 'old' });
  assert.equal(page.messages.length, 6);
  assert.equal(page.nextOffset, 6);
  const next = await f.store.readMemoryArchive(f.assistant, { archiveId: 'old', offset: 6 });
  assert.equal(next.messages.length, 4);
  assert.equal(next.hasMore, false);
  const excluded = await f.store.readMemoryArchive(f.scope, { archiveId: 'agent-old' }, ['one']);
  assert.deepEqual([...excluded.messages].map(item => item.id), ['two']);
  f.agents[0].tags = [];
  assert.match((await f.store.readMemoryArchive(f.scope, { archiveId: 'agent-old' })).notice, /没有可用/);
  await assert.rejects(f.store.readMemoryArchive(f.scope, { archiveId: 'agent-old', offset: -1 }), /无效/);
});

test('model tools bound calls, deduplicate chunks and do not accept identity from tool arguments', async () => {
  const f = await fixture();
  const t = f.tools.createMemoryTools(f.scope);
  const first = await t.execute('memory_read', { archiveId: 'agent-old', userId: 'other' });
  assert.equal(first.messages.length, 2);
  const duplicate = await t.execute('memory_read', { archiveId: 'agent-old' });
  assert.equal(duplicate.messages.length, 0);
  await t.execute('memory_read', { archiveId: 'agent-old', messageId: 'two', contentOffset: 1200 });
  assert.equal((await t.execute('memory_read', { archiveId: 'agent-old' })).ok, false);
  for (let i = 0; i < 4; i++) assert.equal((await t.execute('memory_search', { query: '手机维修' })).ok, true);
  assert.equal((await t.execute('memory_search', { query: '手机维修' })).ok, false);
  assert.equal((await t.execute('unknown', {})).ok, false);
});

test('precise recall includes original evidence while unrelated questions never read raw chat', async () => {
  const f = await fixture();
  const selected = [{ id: 'agent-old' }];
  assert.equal(await f.store.recallOriginalDetails(f.scope, '你好', selected), '');
  assert.equal(await f.store.recallOriginalDetails(f.scope, '还记得手机维修具体安排吗', []), '');
  const result = await f.store.recallOriginalDetails(f.scope, '还记得手机维修具体安排吗', selected);
  assert.match(result, /11点，159元/);
  assert.doesNotMatch(result, /别人的秘密/);
});


test('a streamed model can search then read originals and answer with raw evidence', async () => {
  const f = await fixture();
  const memory = f.tools.createMemoryTools(f.scope);
  const web = createAutoWebTools({ search: async () => assert.fail('memory does not require web search') });
  const called = [];
  let rounds = 0;
  const client = { chat: { completions: { create: async function* (request) {
    rounds++;
    assert.match(request.messages[0].content, /记忆查证/);
    assert.ok(request.tools.some(tool => tool.function.name === 'memory_read'));
    if (rounds <= 2) {
      const name = rounds === 1 ? 'memory_search' : 'memory_read';
      if (rounds === 2) assert.ok(request.messages.some(message => message.role === 'tool' && message.content.includes('agent-old')));
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${rounds}`, type: 'function', function: { name, arguments: JSON.stringify(rounds === 1 ? { query: '手机维修' } : { archiveId: 'agent-old', query: '手机维修' }) } }] } }] };
    } else {
      assert.ok(request.messages.some(message => message.role === 'tool' && message.content.includes('11点，159元')));
      yield { choices: [{ delta: { content: '你当时说的是11点，159元。' } }] };
    }
  } } } };
  const answer = await runAutoWebChat({ client, model: 'fixture', messages: [{ role: 'user', content: '上次手机维修几点、多少钱？' }], web, extraTools: memory.tools, callTool: async (name, args) => { called.push(name); return memory.execute(name, args); } });
  assert.deepEqual(called, ['memory_search', 'memory_read']);
  assert.equal(rounds, 3);
  assert.equal(answer, '你当时说的是11点，159元。');
  assert.deepEqual(web.attachments(), []);
  assert.doesNotMatch(answer, /查询来源|联网/);
});


test('date-only recall filters candidates by source time and handles cross-day Agent archives', async () => {
  const f = await fixture();
  const past = new Date('2026-01-01T12:00:00Z');
  f.rows.push({ id: 'past', userId: 'u', conversationId: 'assistant-chat', summary: '- 用户明确预约手机维修。', startAt: past, endAt: past });
  const result = await f.store.searchMemoryArchives(f.assistant, '2026-01-01');
  assert.deepEqual([...result.items].map(item => item.id), ['past']);
  f.agents[0].createdAt = new Date('2026-10-31T00:00:00Z');
  f.agents[0].tags.push('from-time:2026-10-30T12:00:00Z', 'through-time:2026-10-31T00:00:00Z');
  const crossing = await f.store.searchMemoryArchives(f.scope, '2026-10-30');
  assert.equal(crossing.items[0].id, 'agent-old');
});


test('search pagination preserves matches beyond the first four returned archives', async () => {
  const f = await fixture();
  const date = new Date('2026-10-30T12:00:00Z');
  for (let i = 0; i < 10; i++) f.rows.push({ id: `match-${i}`, userId: 'u', conversationId: 'assistant-chat', summary: `- 用户明确预约手机维修${i}。`, startAt: date, endAt: date });
  const first = await f.store.searchMemoryArchives(f.assistant, '手机维修');
  assert.equal(first.items.length, 4);
  assert.equal(first.nextPage, 1);
  assert.equal(first.nextOffset, 4);
  const next = await f.store.searchMemoryArchives(f.assistant, '手机维修', first.nextPage, first.nextOffset);
  assert.equal(next.items.length, 4);
  assert.equal(next.items.some(item => first.items.some(previous => previous.id === item.id)), false);
});
