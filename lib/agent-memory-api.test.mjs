import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { buildSpaceExperience } from './agent-personal-memory.mjs';
import * as memoryIntent from './personal-assistant/memory-intent.mjs';

async function loadModule(file, modules) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, console, require(name) {
    if (!(name in modules)) throw new Error('Unexpected import: ' + name);
    return modules[name];
  } });
  return exports;
}

test('browser memory endpoint authenticates access and uses route identity instead of body identity', async () => {
  const calls = [];
  let authenticated = true;
  let accessible = true;
  let conversationMode = 'MAIN';
  const route = await loadModule('../app/api/agents/[agentId]/memories/context/route.ts', {
    'next/server': { NextResponse: { json: Response.json } },
    '@/app/api/_lib/auth': { requireAuth() { if (!authenticated) throw new Error('Unauthorized'); return 'owner'; } },
    '@/app/api/_lib/db': { default: { conversation: { async findFirst({ where }) {
      return where.id === 'owned-chat' && where.userId === 'owner' && where.agentId === 'builtin-a' && where.kind === 'AGENT' ? { agentMode: conversationMode } : null;
    } } } },
    '@/app/api/_lib/agent-personal-memory': { async requireAgentMemoryAccess(userId, agentId) {
      assert.equal(userId, 'owner'); assert.equal(agentId, 'builtin-a');
      if (!accessible) throw new Error('Agent not found');
    } },
    '@/lib/agent-memory': { async loadAgentMemoryContext(options) { calls.push(options); return '该角色的记忆'; } },
  });
  const request = { json: async () => ({ userId: 'other', agentId: 'private-role', conversationId: 'owned-chat', agentMode: 'MAIN', query: '记得上次吗' }) };
  const params = { params: Promise.resolve({ agentId: 'builtin-a' }) };
  const response = await route.POST(request, params);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(calls.map(item => ({ ...item })), [{ userId: 'owner', agentId: 'builtin-a', query: '记得上次吗' }]);
  conversationMode = 'TEMPORARY';
  const temporary = await route.POST(request, params);
  assert.equal(temporary.status, 200);
  assert.equal((await temporary.json()).context, '');
  assert.equal((await route.POST({ json: async () => ({ conversationId: 'someone-elses-chat' }) }, params)).status, 404);
  authenticated = false;
  assert.equal((await route.POST(request, params)).status, 401);
  authenticated = true; accessible = false;
  assert.equal((await route.POST(request, params)).status, 404);
  assert.equal(calls.length, 1);
});

test('experience editing, disabling and forgetting cannot change another user or agent records', async () => {
  const records = [
    { id: 'mine', userId: 'owner', agentId: 'a', summary: '原记录', status: 'ACTIVE' },
    { id: 'other-user', userId: 'other', agentId: 'a', summary: '他人记录', status: 'ACTIVE' },
    { id: 'other-role', userId: 'owner', agentId: 'b', summary: '另一个角色', status: 'ACTIVE' },
  ];
  const route = await loadModule('../app/api/agents/[agentId]/experiences/[experienceId]/route.ts', {
    'next/server': { NextResponse: { json: Response.json } },
    '@/app/api/_lib/auth': { requireAuth: () => 'owner' },
    '@/app/api/_lib/agent-personal-memory': { requireAgentMemoryAccess: async () => {} },
    '@/app/api/_lib/db': { default: { agentExperience: {
      async updateMany({ where, data }) {
        const record = records.find(item => item.id === where.id && item.userId === where.userId && item.agentId === where.agentId && item.status !== where.status.not);
        if (record) Object.assign(record, data);
        return { count: record ? 1 : 0 };
      },
      async findFirst({ where }) { return records.find(item => item.id === where.id && item.userId === where.userId && item.agentId === where.agentId); },
    } } },
  });
  const patch = (id, data) => route.PATCH({ json: async () => data }, { params: Promise.resolve({ agentId: 'a', experienceId: id }) });
  for (const id of ['other-user', 'other-role']) assert.equal((await patch(id, { summary: '覆盖' })).status, 404);
  assert.equal((await patch('mine', { summary: '纠正内容' })).status, 200);
  assert.equal(records[0].edited, true);
  assert.equal((await patch('mine', { status: 'DISABLED' })).status, 200);
  assert.equal((await patch('mine', { status: 'DELETED' })).status, 200);
  assert.equal((await patch('mine', { status: 'ACTIVE' })).status, 404);
  assert.equal(records[1].summary, '他人记录');
  assert.equal(records[2].summary, '另一个角色');
});

test('chat archives older batches without deleting raw messages or resurrecting forgotten batches', async () => {
  const allMessages = Array.from({ length: 112 }, (_, index) => ({
    id: String(index).padStart(3, '0'), role: index % 2 ? 'assistant' : 'user',
    content: `${index % 2 ? '建议' : '陈述'} ${index} ${'对话内容'.repeat(100)}`, createdAt: new Date(2026, 9, 20, 0, index),
  }));
  const messages = allMessages.slice(0, 63);
  const experiences = [];
  const db = {
    conversation: { async findFirst({ where }) {
      const conversations = ['MAIN', 'TEMPORARY'].map(agentMode => ({ id: agentMode === 'MAIN' ? 'chat-a' : 'chat-temp', userId: 'owner', agentId: 'a', kind: 'AGENT', agentMode }));
      return conversations.find(item => Object.entries(where).every(([key, value]) => item[key] === value)) || null;
    } },
    message: { async findMany({ where, take }) {
      const after = where.OR?.[0].createdAt.gt;
      const lastId = where.OR?.[1].id.gt;
      return messages.filter(item => !after || item.createdAt > after || item.createdAt.getTime() === after.getTime() && item.id > lastId).slice(0, take);
    } },
    agentExperience: {
      async findFirst() { return [...experiences].sort((a, b) => b.createdAt - a.createdAt || b.taskId.localeCompare(a.taskId))[0]; },
      async upsert({ where, create }) {
        const existing = experiences.find(item => item.taskId === where.userId_agentId_taskId.taskId);
        if (!existing) experiences.push({ ...create, status: 'ACTIVE' });
      },
    },
  };
  const helper = await loadModule('../app/api/_lib/agent-personal-memory.ts', {
    '@/app/api/_lib/db': { default: db }, '@/app/api/_lib/spaces': { resolveAgent: async () => ({ id: 'a' }) },
    '@/lib/agent-personal-memory.mjs': { buildSpaceExperience },
  });
  await helper.archiveAgentChat('other', 'a', 'chat-a');
  assert.equal(experiences.length, 0);
  await helper.archiveAgentChat('owner', 'a', 'chat-a');
  assert.equal(experiences.length, 0);
  messages.push(allMessages[63]);
  await helper.archiveAgentChat('owner', 'a', 'chat-temp');
  assert.equal(experiences.length, 0);
  await helper.archiveAgentChat('owner', 'a', 'chat-a');
  assert.equal(experiences.length, 1);
  assert.match(experiences[0].summary, /用户当时说：陈述 0/);
  assert.match(experiences[0].summary, /我当时回应：建议 1/);
  assert.match(experiences[0].summary, /我当时回应：建议 47 /);
  assert.ok(experiences[0].summary.length <= 2_000);
  assert.equal(experiences[0].tags.filter(tag => tag.startsWith('message:')).length, 48);
  experiences[0].status = 'DELETED';
  await helper.archiveAgentChat('owner', 'a', 'chat-a');
  assert.equal(experiences.length, 1);
  messages.push(...allMessages.slice(64, 111));
  await helper.archiveAgentChat('owner', 'a', 'chat-a');
  assert.equal(experiences.length, 1);
  messages.push(allMessages[111]);
  await helper.archiveAgentChat('owner', 'a', 'chat-a');
  await helper.archiveAgentChat('owner', 'a', 'chat-a');
  assert.equal(experiences.length, 2);
  assert.equal(experiences[0].status, 'DELETED');
  assert.ok(experiences[1].tags.includes('message:048'));
  assert.ok(experiences[1].tags.includes('message:095'));
  assert.match(experiences[1].summary, /我当时回应：建议 95 /);
  assert.equal(messages.length, 112);
});

test('temporary chats cannot extract facts or prepare a local model extraction request', async () => {
  let reads = 0;
  const route = await loadModule('../app/api/agents/[agentId]/memories/extract/route.ts', {
    'next/server': { NextResponse: { json: Response.json } },
    '@/app/api/_lib/auth': { requireAuth: () => 'owner' },
    '@/app/api/_lib/agent-personal-memory': { requireAgentMemoryAccess: async () => {} },
    '@/app/api/_lib/db': { default: {
      conversation: { async findFirst({ where }) {
        return where.id === 'main' && where.userId === 'owner' && where.agentId === 'a' && where.kind === 'AGENT' && where.agentMode === 'MAIN' ? { id: 'main' } : null;
      } },
      agentMemoryItem: { async findMany() { reads++; return []; } },
    } },
    '@/app/api/_lib/agent-model': {}, '@/lib/model-client': {},
    '@/lib/personal-assistant/memory-dedup.mjs': {},
    '@/lib/personal-assistant/memory-intent.mjs': memoryIntent,
  });
  const extract = (conversationId, localOnly) => route.POST({ json: async () => ({ conversationId, localOnly, userMessage: '记住，我喜欢清淡饮食' }) }, { params: Promise.resolve({ agentId: 'a' }) });
  for (const localOnly of [false, true]) {
    const response = await extract('temporary', localOnly);
    assert.deepEqual(await response.json(), { suggestions: [] });
  }
  assert.equal(reads, 0);
  const main = await extract('main', true);
  assert.equal((await main.json()).modelMessages.length, 1);
  assert.equal(reads, 1);
});
