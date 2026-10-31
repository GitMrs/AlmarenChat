import * as recall from './memory-recall.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as shared from './chat-archive.mjs';
import * as policy from '../personal-assistant/experience-context-policy.mjs';
import * as history from '../personal-assistant/history-context.mjs';

const sources = await Promise.all(['../personal-assistant/experience-memory.ts', '../../app/api/_lib/agent-personal-memory.ts']
  .map(async path => ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText));

function fixture(kind, count = 100, long = false) {
  const messages = Array.from({ length: count }, (_, i) => ({
    id: `m${String(i).padStart(3, '0')}`, role: i % 2 ? 'assistant' : 'user',
    content: i % 2 ? '建议今晚去取手机。' : `我预约了维修手机${i}。${long ? '长'.repeat(5000) : ''}`,
    createdAt: new Date(Date.UTC(2026, 9, 30, 10, i)),
  }));
  const records = [];
  const archived = new Set();
  let owned = true;
  let mismatch = false;
  const db = {
    conversation: { findFirst: async ({ where }) => {
      assert.equal(where.userId, 'owner');
      return owned ? { id: 'chat', assistantMode: 'MAIN' } : null;
    } },
    message: {
      count: async () => messages.filter(message => !archived.has(message.id)).length,
      findMany: async ({ where, take }) => {
        assert.equal(where.conversationId, 'chat');
        const time = where.OR?.[0].createdAt.gt;
        const lastId = where.OR?.[1].id.gt;
        return messages.filter(message => !archived.has(message.id) && (!time || message.createdAt > time || (+message.createdAt === +time && message.id > lastId))).slice(0, take);
      },
      updateMany: async ({ where }) => {
        if (mismatch) return { count: 0 };
        where.id.in.forEach(id => archived.add(id));
        return { count: where.id.in.length };
      },
    },
    assistantExperience: { create: async ({ data }) => {
      const record = { ...data, createdAt: new Date() };
      records.push(record);
      return record;
    } },
    agentExperience: {
      findFirst: async () => records.at(-1) || null,
      upsert: async ({ create }) => {
        const record = { ...create, id: `archive-${records.length}` };
        records.push(record);
        return record;
      },
    },
    $transaction: async fn => {
      const length = records.length;
      const before = new Set(archived);
      try { return await fn(db); }
      catch (error) { records.splice(length); archived.clear(); before.forEach(id => archived.add(id)); throw error; }
    },
  };
  const exports = {};
  vm.runInNewContext(sources[kind === 'assistant' ? 0 : 1], { exports, console, require(name) {
    if (name.includes('memory-recall.mjs')) return recall;
    if (name.includes('memory-store')) return { recallOriginalDetails: async () => '' };
    if (name === 'node:crypto') return { randomUUID: () => `archive-${records.length}` };
    if (name.includes('chat-archive.mjs')) return shared;
    if (name.includes('experience-context-policy')) return policy;
    if (name.includes('history-context')) return history;
    if (name.endsWith('/db')) return db;
    if (name === 'next/server') return { after: () => {} };
    return {};
  } });
  return {
    records, messages,
    setOwned: value => { owned = value; },
    setMismatch: () => { mismatch = true; },
    auto: () => kind === 'assistant'
      ? exports.archiveOldMainChatMessages({ userId: 'owner', conversationId: 'chat' })
      : exports.archiveAgentChat('owner', 'agent', 'chat'),
    manual: summarize => kind === 'assistant'
      ? exports.manualArchiveAssistantMessages({ userId: 'owner', conversationId: 'chat', preserveRecent: 4, summarize })
      : exports.archiveAgentChat('owner', 'agent', 'chat', { preserveRecent: 4, summarize }),
  };
}

test('both storage adapters produce the same bounded summaries and exact source references', async () => {
  for (const summarize of [undefined, async () => { throw new Error('offline'); }, async () => '- [用户陈述，2026-10-30 18:00，北京时间] 预约了维修手机。']) {
    const assistant = fixture('assistant');
    const agent = fixture('agent');
    const results = await Promise.all([assistant.manual(summarize), agent.manual(summarize)]);
    assert.equal(results[0].experience.summary, results[1].experience.summary);
    for (const result of results) {
      assert.equal(result.archivedCount, 48);
      assert.equal(result.remainingCount, 52);
      assert.doesNotMatch(result.experience.summary, /今晚去取/);
    }
    assert.equal(assistant.records[0].messageCount, 48);
    assert.equal(agent.records[0].tags.filter(tag => tag.startsWith('message:')).length, 48);
    assert.ok(agent.records[0].tags.includes('message:m047'));
    for (const f of [assistant, agent]) {
      const next = await f.manual(summarize);
      assert.equal(next.archivedCount, 48);
      assert.equal(next.remainingCount, 4);
      assert.equal(f.messages.length, 100);
    }
    assert.equal(assistant.records[1].startAt, assistant.messages[48].createdAt);
    assert.ok(agent.records[1].tags.includes('message:m048'));
  }
});

test('long-message automatic batches advance only through the saved source messages', async () => {
  for (const kind of ['assistant', 'agent']) {
    const f = fixture(kind, 64, true);
    await f.auto();
    // Four 5k user messages plus their short assistant replies fit within 24k.
    const count = kind === 'assistant' ? f.records[0].messageCount : f.records[0].tags.filter(tag => tag.startsWith('message:')).length;
    assert.equal(count, 8);
    assert.equal(f.messages.length, 64);
    const next = await f.manual();
    assert.equal(next.archivedCount, 8);
    assert.equal(next.remainingCount, 48);
  }
});

test('ownership failures do not save archives and assistant claim conflicts roll back', async () => {
  for (const kind of ['assistant', 'agent']) {
    const f = fixture(kind);
    f.setOwned(false);
    await f.auto();
    assert.equal(f.records.length, 0);
  }
  const f = fixture('assistant');
  f.setMismatch();
  await assert.rejects(f.manual(), /并发处理/);
  assert.equal(f.records.length, 0);
});
