import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import * as intent from '../personal-assistant/memory-intent.mjs';
import * as dedup from '../personal-assistant/memory-dedup.mjs';
import * as taxonomy from './memory-taxonomy.mjs';

async function route(kind, action, db) {
  const root = kind === 'agent' ? 'agents/[agentId]' : 'assistant';
  const source = await readFile(new URL(`../../app/api/${root}/memories/${action ? `${action}/` : ''}route.ts`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  const modules = {
    'next/server': { NextResponse: { json: Response.json } },
    'node:crypto': { randomUUID },
    '@/app/api/_lib/db': { default: db },
    '@/app/api/_lib/auth': { requireAuth: () => 'owner' },
    '@/app/api/_lib/agent-personal-memory': { requireAgentMemoryAccess: async () => {} },
    '@/lib/personal-assistant/memory-intent.mjs': intent,
    '@/lib/personal-assistant/memory-dedup.mjs': dedup,
    '@/lib/memory/memory-taxonomy.mjs': taxonomy,
    '@/lib/agents/growth/state.mjs': {},
    '@/app/api/_lib/agent-model': {},
    '@/lib/core/model-client': {},
  };
  vm.runInNewContext(output, { exports, console, require(name) {
    assert.ok(name in modules, `Unexpected import: ${name}`);
    return modules[name];
  } });
  return body => exports.POST({ json: async () => body }, { params: Promise.resolve({ agentId: 'a' }) });
}

for (const kind of ['assistant', 'agent']) {
  test(`${kind} extraction returns grounded typed candidates without saving them`, async () => {
    const userMessage = '我喜欢喝茶。';
    const db = {
      conversation: { findFirst: async () => ({ id: 'chat', assistantMode: 'MAIN', agentMode: 'MAIN' }) },
      message: { findFirst: async () => ({ id: 'user-message', content: userMessage }) },
      assistantMemoryItem: { findMany: async () => [] },
      agentMemoryItem: { findMany: async () => [] },
    };
    const post = await route(kind, 'extract', db);
    const result = await post({ conversationId: 'chat', sourceMessageId: 'user-message', userMessage, assistantMessage: '建议你喝咖啡。', localResponse: JSON.stringify({ extracted: [
      { content: '喜欢喝茶', category: 'preference', evidenceQuote: '我喜欢喝茶', factKey: '用户.饮品' },
      { content: '喜欢喝咖啡', category: 'preference', evidenceQuote: '建议你喝咖啡' },
      { content: '明天买茶', category: 'plan', evidenceQuote: '我喜欢喝茶' },
      { content: '用户住在北京', category: 'stable_fact' },
    ] }) });
    assert.equal(result.status, 200);
    assert.deepEqual((await result.json()).suggestions, [{
      content: '喜欢喝茶', category: 'preference', evidenceQuote: '我喜欢喝茶',
      factKey: '用户.饮品', sourceMessageId: 'user-message',
    }]);
  });

  test(`${kind} confirmed memory normalizes types, validates provenance and preserves superseded history`, async () => {
    const records = [{ id: 'old', userId: 'owner', agentId: kind === 'agent' ? 'a' : null, content: '喜欢喝咖啡', category: 'preference', factKey: '用户.饮品', status: 'ACTIVE' }];
    const store = {
      findMany: async () => records.filter(item => item.status === 'ACTIVE'),
      create: async ({ data }) => { const item = { ...data, id: 'new', status: 'ACTIVE' }; records.push(item); return item; },
      updateMany: async ({ where, data }) => {
        for (const item of records) if (item.id !== where.id.not && item.factKey === where.factKey && item.status === 'ACTIVE') Object.assign(item, data);
      },
    };
    const db = {
      assistantMemoryItem: store, agentMemoryItem: store,
      message: { findFirst: async ({ where }) => {
        assert.equal(where.role, 'user');
        assert.equal(where.conversation.userId, 'owner');
        return where.id === 'user-message' ? { id: 'user-message', content: '我喜欢喝茶' } : null;
      } },
      $transaction: async callback => callback({ assistantMemoryItem: store, agentMemoryItem: store }),
    };
    const post = await route(kind, '', db);
    const body = { content: '喜欢喝茶', category: 'fact', evidenceQuote: '我喜欢喝茶', sourceMessageId: 'user-message', factKey: '用户.饮品' };
    for (const category of ['plan', 'current_state', 'event', 'episode', 'unknown']) {
      assert.equal((await post({ ...body, category })).status, 400);
    }
    assert.equal((await post({ ...body, sourceMessageId: 'foreign-message' })).status, 400);
    assert.equal((await post({ ...body, evidenceQuote: '我喜欢咖啡' })).status, 400);
    assert.equal(records.length, 1);
    assert.equal((await post(body)).status, 200);
    assert.equal(records[0].status, 'SUPERSEDED');
    assert.equal(records[0].supersededById, 'new');
    assert.equal(records[0].content, '喜欢喝咖啡');
    assert.equal(records[1].category, 'stable_fact');
    assert.equal(records[1].trustStatus, 'VERIFIED');
    assert.equal(records[1].sourceMessageId, 'user-message');
  });
}
