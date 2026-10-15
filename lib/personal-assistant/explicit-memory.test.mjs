import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as intent from './memory-intent.mjs';
import * as dedup from './memory-dedup.mjs';
import { classifyReminderRequest } from './reminder-intent.mjs';

test('explicit memory requests do not become reminders', () => {
  for (const text of ['帮我记一下：我要减肥', '那你记一下，我要减肥', '请帮我记住：我喜欢喝茶']) {
    assert.ok(intent.explicitMemoryContent(text));
    assert.equal(intent.shouldExtractMemorySuggestion(text), true);
    assert.deepEqual(classifyReminderRequest(text), { explicit: false, hasCue: false });
  }
  for (const text of ['明天提醒我运动', '帮我记一下明天三点提醒我开会', '帮我记一下买牛奶', '我今天吃了面']) {
    assert.equal(intent.explicitMemoryContent(text), null);
  }
  assert.equal(intent.explicitMemoryContent('这个你记一下'), null);
});

test('normalization uses valid JSON or preserves the original without truncation', () => {
  assert.deepEqual(intent.parseExplicitMemory('{"content":"用户目前有减肥目标"}', '我要减肥'), { content: '用户目前有减肥目标', category: 'fact' });
  for (const raw of ['', 'not json', '{}', '{"content":""}', JSON.stringify({ content: '长'.repeat(501) })]) {
    assert.equal(intent.parseExplicitMemory(raw, '我要减肥').content, '我要减肥');
  }
  assert.equal(intent.memoryConfirmation('确认保存！'), 'confirm');
  assert.equal(intent.memoryConfirmation('取消'), 'cancel');
  assert.equal(intent.memoryConfirmation('好的，不过今天有点忙'), null);
});

// Execute the actual transaction handler against an isolated in-memory repository.
async function fixture() {
  let memories = [];
  let messages = [];
  let nextId = 0;
  const tx = {
    assistantMemoryItem: {
      findFirst: async () => memories.filter((m) => m.status === 'PENDING_QQ').at(-1) || null,
      findMany: async () => memories.filter((m) => m.status === 'ACTIVE'),
      create: async ({ data }) => { memories.push({ id: `memory-${++nextId}`, createdAt: new Date(), ...data }); },
      update: async ({ where, data }) => { Object.assign(memories.find((m) => m.id === where.id), data); },
      deleteMany: async () => { memories = memories.filter((m) => m.status !== 'PENDING_QQ'); },
    },
    message: {
      findUnique: async ({ where }) => messages.find((m) => m.id === where.id) || null,
      findFirst: async () => messages.at(-1) || null,
      create: async ({ data }) => { messages.push(data); },
    },
    conversation: { update: async () => {} },
  };
  const source = await readFile(new URL('./qq-memory.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Date,
    require: (name) => name.includes('/db') ? { default: { $transaction: (fn) => fn(tx) } }
      : name.includes('memory-intent') ? intent : dedup,
  });
  return {
    memories: () => memories,
    messages: () => messages,
    send: (message, id = `event-${++nextId}`) => exports.handleQQMemoryRequest({
      userId: 'user-1', conversationId: 'chat-1', message,
      userMessageId: `${id}-user`, assistantMessageId: `${id}-assistant`,
      normalize: async (content) => ({ content, category: 'fact' }),
    }),
  };
}

test('QQ candidates require confirmation, persist messages, deduplicate and replay safely', async () => {
  const f = await fixture();
  assert.match(await f.send('帮我记一下：我要减肥'), /准备存入长期记忆/);
  assert.equal(f.memories()[0].status, 'PENDING_QQ');
  const reply = await f.send('确认保存', 'confirmation');
  assert.match(reply, /已存入长期记忆/);
  assert.equal(f.memories()[0].status, 'ACTIVE');
  assert.equal(await f.send('确认保存', 'confirmation'), reply);
  assert.equal(f.messages().length, 4);
  await f.send('帮我记一下：我要减肥');
  assert.match(await f.send('确认保存'), /长期记忆中已有/);
  assert.equal(f.memories().length, 1);
});

test('QQ cancellation, unrelated chat and expired confirmations never activate memory', async () => {
  const f = await fixture();
  await f.send('帮我记一下：我要减肥');
  assert.match(await f.send('取消'), /没有存入/);
  assert.equal(f.memories().length, 0);
  await f.send('帮我记一下：我要减肥');
  assert.equal(await f.send('今天天气不错'), null);
  assert.equal(await f.send('确认保存'), null);
  assert.equal(f.memories().length, 0);
  await f.send('帮我记一下：我要减肥');
  f.memories()[0].createdAt = new Date(Date.now() - 31 * 60_000);
  assert.match(await f.send('确认保存'), /已失效/);
  assert.equal(f.memories().length, 0);
  await f.send('帮我记一下：我要减肥');
  f.messages().push({ id: 'web-reply', source: 'WEB' });
  assert.match(await f.send('确认保存'), /已失效/);
  assert.equal(f.memories().length, 0);
});

test('QQ vague and oversized requests ask for clarification instead of saving', async () => {
  const f = await fixture();
  assert.match(await f.send('帮我记一下'), /具体内容/);
  assert.match(await f.send('帮我记一下：这个'), /具体内容/);
  assert.match(await f.send(`帮我记一下：${'字'.repeat(501)}`), /超过500字/);
  assert.equal(f.memories().length, 0);
});
