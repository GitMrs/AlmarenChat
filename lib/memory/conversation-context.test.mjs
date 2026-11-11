import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import Database from 'better-sqlite3';
import * as policy from './conversation-context-policy.mjs';
import { isTransientModelError } from '../agents/runtime/tool-loop.mjs';
import { createSummaryBackoff } from './summary-backoff.mjs';

const source = await readFile(new URL('./conversation-context.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(part => matches(row, part));
    if (key === 'OR') return value.some(part => matches(row, part));
    if (value && typeof value === 'object' && !(value instanceof Date)) return Object.entries(value).every(([op, arg]) => {
      if (op === 'in') return arg.includes(row[key]);
      if (op === 'notIn') return !arg.includes(row[key]);
      if (op === 'lt') return row[key] < arg;
      if (op === 'gt') return row[key] > arg;
      return true;
    });
    return value instanceof Date ? +row[key] === +value : row[key] === value;
  });
}
function fixture(count = 64, chars = 20) {
  const rows = Array.from({ length: count }, (_, i) => ({ id: `m${String(i).padStart(4, '0')}`, conversationId: 'c', role: i % 2 ? 'assistant' : 'user', content: `消息${i}：${'文'.repeat(chars)}`, createdAt: new Date(1793400000000 + i * 1000), assistantExperienceId: i < 48 ? 'archived' : null }));
  let saved = null;
  const db = {
    conversation: { findFirst: async ({ where }) => where.id === 'c' && where.userId === 'u' ? { id: 'c' } : null },
    message: {
      findMany: async ({ where, orderBy, take }) => {
        const selected = rows.filter(row => matches(row, where)).sort((a, b) => +a.createdAt - +b.createdAt || a.id.localeCompare(b.id));
        if (orderBy?.[0].createdAt === 'desc') selected.reverse();
        return selected.slice(0, take);
      },
      findFirst: async ({ where }) => rows.find(row => matches(row, where)) || null,
      count: async ({ where }) => rows.filter(row => matches(row, where)).length,
    },
    conversationContextState: {
      findUnique: async () => saved && { ...saved },
      create: async ({ data }) => { saved = { ...data }; return saved; },
      update: async ({ data }) => { saved = { ...saved, ...data }; return saved; },
      updateMany: async ({ where, data }) => { if (saved?.version !== where.version) return { count: 0 }; saved = { ...saved, ...data }; return { count: 1 }; },
    },
    $transaction: async operation => operation(db),
  };
  const exports = {};
  const warnings = [];
  let now = 1000;
  const backoff = createSummaryBackoff({ now: () => now });
  vm.runInNewContext(compiled, { exports, console: { ...console, warn: (...args) => warnings.push(args) }, require: name => name.endsWith('/db') ? { default: db } : name.endsWith('/tool-loop.mjs') ? { isTransientModelError } : name.endsWith('/summary-backoff.mjs') ? { summaryBackoff: backoff } : policy });
  const prepare = options => exports.prepareConversationContext({ userId: 'u', conversationId: 'c', maxMessages: 60, requiredSystem: '当前时间与角色规则', currentMessage: { role: 'user', content: '继续' }, ...options });
  return { rows, prepare, get saved() { return saved; }, exports, db, warnings, advance: ms => { now += ms; } };
}

test('63/64/65 boundary keeps recent archived originals and bridges every omitted prefix', async () => {
  assert.equal(policy.ASSISTANT_RECENT_MESSAGE_LIMIT, 60);
  for (const count of [40, 60, 61, 63, 64, 65, 80]) {
    const f = fixture(count);
    const plan = await f.prepare();
    assert.ok(plan.history.length <= 60);
    assert.equal(plan.history.length + f.saved.sourceCount, count);
    assert.deepEqual(plan.history.map(message => message.id), f.rows.slice(f.saved.sourceCount).map(message => message.id));
    assert.equal(f.saved.throughMessageId, f.saved.sourceCount ? f.rows[f.saved.sourceCount - 1].id : null);
    assert.equal(plan.messages.at(-1).content, '继续');
    if (count >= 61) assert.ok(plan.messages.some(message => message.content.includes('当前会话承接记录')));
    if (count === 64) assert.equal(plan.history.length, 60); // not 16 after archiving 48
  }
});

test('Agent configurable limits and growing windows rebuild the correct bridge boundary', async () => {
  const f = fixture(70);
  const first = await f.prepare({ maxMessages: 40 });
  assert.equal(first.history.length, 40);
  assert.equal(f.saved.sourceCount, 30);
  const expanded = await f.prepare({ maxMessages: 60 });
  assert.equal(expanded.history.length, 60);
  assert.equal(f.saved.sourceCount, 10);
  assert.equal(f.saved.throughMessageId, f.rows[9].id);
  const previous = f.saved.summary;
  const again = await f.prepare({ maxMessages: 60 });
  assert.equal(again.summary, previous);
});

test('full request budget prioritizes continuity and reports omitted optional memory', async () => {
  const f = fixture(64, 1000);
  const plan = await f.prepare({ modelContextWindow: 32768, optional: [{ name: '无关长资料', content: '长'.repeat(30000) }] });
  assert.ok(plan.manifest.estimatedInputTokens <= plan.manifest.inputBudget);
  assert.ok(plan.history.length < 60);
  assert.equal(plan.history.length + f.saved.sourceCount, 64);
  assert.deepEqual([...plan.manifest.omitted], ['无关长资料']);
  assert.deepEqual(plan.history.map(message => message.id), f.rows.slice(f.saved.sourceCount).map(message => message.id));
});

test('runtime context and historical data occupy separate system layers', async () => {
  const f = fixture(10);
  const plan = await f.prepare({
    runtimeSystem: '当前现实时间：2026-11-02 09:26。对话状态：continue。',
    optional: [{ name: '相关历史资料', content: '【相关历史资料】过去发生的内容，仅供参考。' }],
  });
  const systems = plan.messages.filter(message => message.role === 'system');
  assert.equal(systems.length, 4);
  assert.match(systems[0].content, /当前时间与角色规则/);
  assert.match(systems[1].content, /当前现实时间：2026-11-02/);
  assert.match(systems[2].content, /历史消息时间索引/);
  assert.match(systems[3].content, /相关历史资料/);
});

test('model history stays clean while runtime context carries time', () => {
  const recent = [
    { role: 'user', content: '还行吧', createdAt: new Date('2026-11-02T04:09:11.000Z') },
    { role: 'assistant', content: '午休能趴一会儿', createdAt: new Date('2026-11-02T04:09:43.000Z') },
    { role: 'user', content: '看看你在干什么呢？', createdAt: new Date('2026-11-02T09:00:52.000Z') },
  ];
  const request = policy.composeConversationRequest({
    requiredSystem: '规则', runtimeSystem: '当前现实时间：2026-11-02 17:00。',
    recent, currentMessage: { role: 'user', content: '现在呢？' }, budget: 10000,
  });
  assert.equal(request.messages[3].content, '还行吧');
  assert.equal(request.messages[4].content, '午休能趴一会儿');
  assert.equal(request.messages[5].content, '看看你在干什么呢？');
  assert.match(request.messages[1].content, /当前现实时间：2026-11-02 17:00/);
  assert.match(request.messages[2].content, /历史第 1 条.*2026-11-02 12:09/);
  assert.match(request.messages[2].content, /历史第 3 条.*2026-11-02 17:00/);
  assert.doesNotMatch(request.messages[3].content, /历史消息时间/);
  assert.equal(recent[0].content, '还行吧');
});

test('a posted current user and multimodal current message are included only once', async () => {
  const f = fixture(65);
  f.rows.at(-1).content = '继续';
  const plan = await f.prepare({ excludeMessageIds: [f.rows.at(-1).id], currentMessage: { role: 'user', content: [{ type: 'text', text: '继续' }, { type: 'image_url', image_url: { url: 'data:example' } }] } });
  assert.equal(plan.history.length + f.saved.sourceCount, 64);
  assert.equal(plan.messages.filter(message => message.content === '继续').length, 0);
  assert.equal(plan.messages.at(-1).content[0].text, '继续');
});

test('summary failures never commit a new cursor and invalid summaries fall back safely', async () => {
  const f = fixture(100, 1000);
  await assert.rejects(f.prepare({ summarize: async () => { throw new Error('模型超时'); } }), /模型超时/);
  assert.equal(f.saved, null);
  const fallback = await f.prepare({ summarize: async () => '无依据的胡乱总结' });
  assert.match(fallback.summary, /当前工作记忆/);
  assert.ok(f.saved);
  await assert.rejects(f.prepare({ requiredSystem: '长'.repeat(200000) }), /超出上下文预算/);
  assert.ok(f.saved);
});

test('a summary SDK timeout continues the turn with bounded quoted context and no new cursor', async () => {
  const f = fixture(100, 1000);
  let calls = 0;
  const plan = await f.prepare({ summarize: async () => {
    calls++;
    throw Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });
  } });
  assert.equal(calls, 1);
  assert.equal(f.saved, null);
  assert.equal(plan.manifest.summaryFallback, 'temporary-excerpts');
  assert.ok(plan.messages.some(message => message.content.includes('摘要整理暂不可用')));
  assert.match(plan.summary, /用户原话/);
  assert.match(plan.summary, /ID:m/);
  assert.equal(plan.messages.at(-1).content, '继续');
  assert.ok(plan.manifest.estimatedInputTokens <= plan.manifest.inputBudget);
  assert.equal(f.warnings.length, 1);
});

test('temporary excerpts retain the prior checkpoint and a later healthy request can commit', async () => {
  const f = fixture(100, 1000);
  const checkpoint = { conversationId: 'c', summary: '之前有效的承接摘要，不得丢失。',
    throughMessageId: f.rows[5].id, throughCreatedAt: f.rows[5].createdAt, sourceCount: 6, version: 7 };
  await f.db.conversationContextState.create({ data: checkpoint });
  const plan = await f.prepare({ summarize: async () => { throw Object.assign(new Error('Connection error.'), { name: 'APIConnectionError' }); } });
  assert.deepEqual(f.saved, checkpoint);
  assert.equal(plan.manifest.version, 7);
  assert.ok(plan.summary.includes(checkpoint.summary));
  f.advance(60_001);
  await f.prepare({ summarize: async () => '无效模型摘要，继续使用已有安全摘录策略' });
  assert.equal(f.saved.version, 8);
  assert.ok(f.saved.sourceCount > 6);
});

test('summary failure cooldown skips repeated work, then permits recovery without moving the cursor early', async () => {
  const f = fixture(100, 1000);
  let calls = 0;
  const summarize = async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });
    return '格式无效，使用安全摘录';
  };
  await f.prepare({ summarize });
  const during = await f.prepare({ summarize, currentMessage: { role: 'user', content: '这是本轮的新输入' } });
  assert.equal(calls, 1);
  assert.equal(f.saved, null);
  assert.equal(during.messages.at(-1).content, '这是本轮的新输入');
  assert.equal(during.manifest.summaryRetryAfterMs, 60_000);
  assert.equal(f.warnings.length, 1);
  f.advance(60_001);
  await f.prepare({ summarize });
  assert.equal(calls, 2);
  assert.ok(f.saved);
});

test('summary authentication errors and user cancellation still stop without committing', async () => {
  for (const error of [Object.assign(new Error('invalid key'), { status: 401 }), Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' })]) {
    const f = fixture(100, 1000);
    await assert.rejects(f.prepare({ summarize: async () => { throw error; } }), e => e === error);
    assert.equal(f.saved, null);
  }
});

test('source deletion invalidates the bridge and ownership failures never read other chats', async () => {
  const f = fixture(70);
  await f.prepare({ maxMessages: 40 });
  f.rows.splice(2, 1);
  const plan = await f.prepare({ maxMessages: 40 });
  assert.equal(plan.history.length + f.saved.sourceCount, 69);
  assert.doesNotMatch(plan.summary, /ID:m0002\]/);
  await assert.rejects(f.prepare({ userId: 'other' }), /not found/);
});

test('working-state migration creates separate state and cascade deletion without touching raw messages', async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE Conversation (id TEXT PRIMARY KEY); INSERT INTO Conversation VALUES (\'c\');');
  db.exec(await readFile(new URL('../../prisma/migrations/20261031120000_add_conversation_context_state/migration.sql', import.meta.url), 'utf8'));
  db.prepare('INSERT INTO ConversationContextState (conversationId,updatedAt) VALUES (?,?)').run('c', new Date().toISOString());
  assert.equal(db.prepare('SELECT count(*) AS n FROM ConversationContextState').get().n, 1);
  db.prepare('DELETE FROM Conversation WHERE id = ?').run('c');
  assert.equal(db.prepare('SELECT count(*) AS n FROM ConversationContextState').get().n, 0);
  db.close();
});


test('incremental handoff avoids repeated model calls and supports a valid model checkpoint', async () => {
  const f = fixture(70);
  let calls = 0;
  const summarize = async prompt => {
    calls++;
    const ids = [...prompt.matchAll(/ID:(m\d+)\]/g)].map(match => match[1]);
    return `【当前目标】恢复对话\n【用户已确认】未知\n【助理待确认】未知\n【进度与取消】按原文核对\n【来源ID】${ids.at(-1)}`;
  };
  await f.prepare({ maxMessages: 40, summarize });
  assert.equal(calls, 0);
  f.rows.push(...Array.from({ length: 60 }, (_, index) => ({ id: `m${String(index + 70).padStart(4, '0')}`, conversationId: 'c', role: index % 2 ? 'assistant' : 'user', content: '长'.repeat(800), createdAt: new Date(1793400000000 + (index + 70) * 1000) })));
  const plan = await f.prepare({ maxMessages: 40, summarize });
  assert.equal(calls, 1);
  assert.equal(plan.history.length + f.saved.sourceCount, 130);
  assert.match(f.saved.summary, /用户已确认】未知/);
});

test('concurrent checkpoint updates cannot be overwritten by a delayed summary', async () => {
  const f = fixture(100, 1000);
  await assert.rejects(f.prepare({ maxMessages: 40, summarize: async prompt => {
    await f.db.conversationContextState.create({ data: { conversationId: 'c', summary: '另一请求的有效摘要', version: 999 } });
    const id = [...prompt.matchAll(/ID:(m\d+)\]/g)].at(-1)[1];
    return `【当前目标】恢复\n【用户已确认】未知\n【助理待确认】未知\n【进度与取消】未知\n【来源ID】${id}`;
  } }), /另一请求更新/);
  assert.equal(f.saved.version, 999);
  assert.equal(f.saved.summary, '另一请求的有效摘要');
});


test('extractive local handoff keeps explicit user constraints and the newest progress as labelled quotes', () => {
  const messages = Array.from({ length: 40 }, (_, index) => ({ id: `q${index}`, createdAt: new Date(1793400000000 + index * 1000), role: index % 2 ? 'assistant' : 'user', content: index === 0 ? '本轮只做规划，不要修改代码。' : `第${index}条进度：${'内容'.repeat(150)}` }));
  const summary = policy.extractiveWorkingSummary(policy.quotedWorkingSummary('', messages));
  assert.ok(summary.length <= policy.WORKING_SUMMARY_MAX_CHARS);
  assert.match(summary, /本轮只做规划，不要修改代码/);
  assert.match(summary, /ID:q39/);
  assert.match(summary, /助理原话，尚未独立核实/);
  assert.ok(summary.length <= policy.EXTRACTIVE_WORKING_SUMMARY_MAX_CHARS);
  const next = policy.extractiveWorkingSummary(policy.quotedWorkingSummary(summary, messages.slice(-2)));
  assert.equal((next.match(/【当前工作记忆/g) || []).length, 1);
});

test('working summary is injected only for a related continuation', () => {
  const summary = '【当前目标】继续处理 Google One 退款到账问题';
  assert.equal(policy.shouldIncludeWorkingSummary(summary, { role: 'user', content: '早上好' }), false);
  assert.equal(policy.shouldIncludeWorkingSummary(summary, { role: 'user', content: '中午吃什么' }), false);
  assert.equal(policy.shouldIncludeWorkingSummary(summary, { role: 'user', content: 'Google 退款后来到账了吗' }), true);
  assert.equal(policy.shouldIncludeWorkingSummary(summary, { role: 'user', content: '继续刚才那个事情' }), true);
});


test('identical consecutive user text is never treated as duplicate without an explicit message ID', async () => {
  const f = fixture(65);
  f.rows.at(-1).content = '继续';
  const current = await f.prepare();
  assert.equal(current.history.length + f.saved.sourceCount, 65);
  assert.ok(current.history.some(message => message.id === f.rows.at(-1).id));
  assert.equal(current.messages.at(-1).content, '继续');
  const exact = await f.prepare({ excludeMessageIds: [f.rows.at(-1).id] });
  assert.equal(exact.history.length + f.saved.sourceCount, 64);
});
