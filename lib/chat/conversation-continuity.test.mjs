import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildRecentStateContinuityGuidance, buildRecentStateRuntimeContext, extractRecentStates, buildConversationContinuityGuidance, classifyConversationContinuity } from './conversation-continuity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const at = (minutes) => new Date(Date.parse('2026-10-30T00:00:00.000Z') + minutes * 60_000);

test('explicit continuation wins over a long gap', () => {
  const result = classifyConversationContinuity({
    message: '那后来呢？',
    history: [{ role: 'user', content: '你找到饺子了吗', createdAt: at(0) }],
    now: at(180),
  });
  assert.equal(result.state, 'continue');
  assert.match(buildConversationContinuityGuidance({ message: '那后来呢？', history: [{ role: 'user', content: '你找到饺子了吗', createdAt: at(0) }], now: at(180) }), /明确延续/);
  assert.match(buildConversationContinuityGuidance({ message: '那后来呢？', history: [{ role: 'user', content: '你找到饺子了吗', createdAt: at(0) }], now: at(180) }), /回复前内部检查/);
  assert.match(buildConversationContinuityGuidance({ message: '那后来呢？', history: [{ role: 'user', content: '你找到饺子了吗', createdAt: at(0) }], now: at(180) }), /不展示检查过程/);
});

test('a filler before an explicit continuation still continues', () => {
  const result = classifyConversationContinuity({
    message: '好，后来呢？',
    history: [{ role: 'user', content: '你找到饺子了吗', createdAt: at(0) }],
    now: at(180),
  });
  assert.equal(result.state, 'continue');
});

test('an unrelated message after a long gap is stale', () => {
  const result = classifyConversationContinuity({
    message: '帮我查一下天气',
    history: [{ role: 'assistant', content: '刚才去看看饺子吧', createdAt: at(0) }],
    now: at(180),
  });
  assert.equal(result.state, 'stale');
});

test('explicit history references are treated as past', () => {
  const result = classifyConversationContinuity({
    message: '昨天吃了什么？',
    history: [{ role: 'assistant', content: '今天吃饺子', createdAt: at(5) }],
    now: at(10),
  });
  assert.equal(result.state, 'past');
});

test('a short related message within an hour continues naturally', () => {
  const result = classifyConversationContinuity({
    message: '饺子呢',
    history: [{ role: 'user', content: '今天想吃饺子', createdAt: at(0) }],
    now: at(20),
  });
  assert.equal(result.state, 'continue');
});

test('gap text converts hours to days correctly', () => {
  const history = [{ role: 'assistant', content: '上一轮', createdAt: at(0) }];
  assert.match(buildConversationContinuityGuidance({ message: '新话题', history, now: at(24 * 60) }), /约 1 天/);
  assert.match(buildConversationContinuityGuidance({ message: '新话题', history, now: at(48 * 60) }), /约 2 天/);
  assert.match(buildConversationContinuityGuidance({ message: '新话题', history, now: at(72 * 60) }), /约 3 天/);
});

test('a short unrelated message within an hour stays active without asking to continue', () => {
  const result = classifyConversationContinuity({
    message: '帮我查一下天气',
    history: [{ role: 'user', content: '我在吃饭', createdAt: at(0) }],
    now: at(10),
  });
  assert.equal(result.state, 'active');
  const guidance = buildConversationContinuityGuidance({
    message: '帮我查一下天气',
    history: [{ role: 'user', content: '我在吃饭', createdAt: at(0) }],
    now: at(10),
  });
  assert.match(guidance, /直接回答当前消息/);
  assert.doesNotMatch(guidance, /是否继续/);
});

test('a short answer to the assistant question continues even after an hour', () => {
  const result = classifyConversationContinuity({
    message: '好啊',
    history: [
      { role: 'user', content: '今天吃什么', createdAt: at(0) },
      { role: 'assistant', content: '要不要我帮你查饺子店？', createdAt: at(1) },
    ],
    now: at(120),
  });
  assert.equal(result.state, 'continue');
});

test('standalone status updates after a long gap are stale', () => {
  for (const message of ['我回来了', '好了', '吃完了']) {
    const result = classifyConversationContinuity({
      message,
      history: [{ role: 'user', content: '我在改一个 bug', createdAt: at(0) }],
      now: at(3 * 24 * 60),
    });
    assert.equal(result.state, 'stale', message);
  }
});

test('bare remember is not treated as a history reference', () => {
  const result = classifyConversationContinuity({
    message: '记得帮我查天气',
    history: [{ role: 'user', content: '我在吃饭', createdAt: at(0) }],
    now: at(10),
  });
  assert.equal(result.state, 'active');
  assert.equal(result.explicitHistory, false);
});

test('common bigrams do not make unrelated topics continue', () => {
  const result = classifyConversationContinuity({
    message: '今天天气怎么样',
    history: [{ role: 'user', content: '今天吃什么', createdAt: at(0) }],
    now: at(20),
  });
  assert.equal(result.state, 'active');
  assert.equal(result.related, false);
});

test('a recent history reference is past but not stale', () => {
  const result = classifyConversationContinuity({
    message: '刚才那个报错还在',
    history: [{ role: 'user', content: '报错修了吗', createdAt: at(0) }],
    now: at(2),
  });
  assert.equal(result.state, 'past');
  assert.match(buildConversationContinuityGuidance({ message: '刚才那个报错还在', history: [{ role: 'user', content: '报错修了吗', createdAt: at(0) }], now: at(2) }), /还在/);
});

test('missing timestamps are uncertain rather than guessed', () => {
  const result = classifyConversationContinuity({
    message: '帮我查一下天气',
    history: [{ role: 'user', content: '我在吃饭' }],
  });
  assert.equal(result.state, 'uncertain');
});

test('companion does not carry an unfinished sleep state across a new day', () => {
  const guidance = buildRecentStateContinuityGuidance({
    message: '早上好',
    history: [{ role: 'user', content: '晚安，我睡了', createdAt: new Date('2026-10-30T14:00:00.000Z') }],
    now: new Date('2026-10-30T23:00:00.000Z'),
  });
  assert.match(guidance, /新的寒暄/);
  assert.doesNotMatch(guidance, /尚未确认结束/);
});

test('companion may check an unresolved same-day activity without treating it as current', () => {
  const guidance = buildRecentStateContinuityGuidance({
    message: '嗨',
    history: [{ role: 'user', content: '我在吃饭', createdAt: new Date('2026-10-30T01:00:00.000Z') }],
    now: new Date('2026-10-30T04:00:00.000Z'),
  });
  assert.match(guidance, /尚未确认结束/);
  assert.match(guidance, /不能直接当成现在/);
});

test('recent state is structured, time-bound, and sourced from user messages', () => {
  const source = { id: 'msg-breakfast', role: 'user', content: '我正在吃早饭', createdAt: new Date('2026-10-30T01:00:00.000Z') };
  const states = extractRecentStates({ history: [source], now: new Date('2026-10-30T04:00:00.000Z') });
  assert.deepEqual(states[0], {
    topic: '吃饭', value: '我正在吃早饭', status: 'UNCONFIRMED',
    mentionedAt: '2026-10-30T01:00:00.000Z', startsAt: '2026-10-30T01:00:00.000Z',
    expiresAt: '2026-10-30T07:00:00.000Z', sourceMessageId: 'msg-breakfast',
  });
  assert.match(buildRecentStateRuntimeContext({ history: [source], now: new Date('2026-10-30T04:00:00.000Z') }), /来源 msg-breakfast/);
});

test('recent state closes from a later user confirmation', () => {
  const states = extractRecentStates({
    history: [
      { id: 'msg-meal', role: 'user', content: '我在吃饭', createdAt: new Date('2026-10-30T01:00:00.000Z') },
      { id: 'msg-done', role: 'user', content: '吃完了', createdAt: new Date('2026-10-30T02:00:00.000Z') },
    ],
    now: new Date('2026-10-30T04:00:00.000Z'),
  });
  assert.equal(states[0].status, 'CLOSED');
  assert.equal(buildRecentStateRuntimeContext({ history: [
    { id: 'msg-meal', role: 'user', content: '我在吃饭', createdAt: new Date('2026-10-30T01:00:00.000Z') },
    { id: 'msg-done', role: 'user', content: '吃完了', createdAt: new Date('2026-10-30T02:00:00.000Z') },
  ], now: new Date('2026-10-30T04:00:00.000Z') }), '');
});

test('topic-specific completion does not close unrelated recent states', () => {
  const states = extractRecentStates({
    history: [
      { id: 'meal', role: 'user', content: '我在吃饭', createdAt: new Date('2026-11-02T01:00:00.000Z') },
      { id: 'commute', role: 'user', content: '我现在在车上', createdAt: new Date('2026-11-02T01:10:00.000Z') },
      { id: 'home', role: 'user', content: '到家了', createdAt: new Date('2026-11-02T01:40:00.000Z') },
    ],
    now: new Date('2026-11-02T02:00:00.000Z'),
  });
  assert.equal(states.find(state => state.topic === '通勤').status, 'CLOSED');
  assert.equal(states.find(state => state.topic === '吃饭').status, 'UNCONFIRMED');
});

test('meal completion closes only the meal state', () => {
  const states = extractRecentStates({
    history: [
      { id: 'work', role: 'user', content: '我正在工作', createdAt: new Date('2026-11-02T01:00:00.000Z') },
      { id: 'meal', role: 'user', content: '我在吃饭', createdAt: new Date('2026-11-02T01:10:00.000Z') },
      { id: 'done', role: 'user', content: '吃完了', createdAt: new Date('2026-11-02T01:40:00.000Z') },
    ],
    now: new Date('2026-11-02T02:00:00.000Z'),
  });
  assert.equal(states.find(state => state.topic === '吃饭').status, 'CLOSED');
  assert.equal(states.find(state => state.topic === '工作').status, 'UNCONFIRMED');
});

test('time expressions create plans in Beijing time', () => {
  const cases = [
    ['明天上班', '工作', '2026-11-02T16:00:00.000Z'],
    ['下午去医院', '就医', '2026-11-02T05:00:00.000Z'],
    ['周末回家', '行程', '2026-11-06T16:00:00.000Z'],
    ['今晚早点睡', '睡眠', '2026-11-02T10:00:00.000Z'],
  ];
  for (const [content, topic, startsAt] of cases) {
    const [state] = extractRecentStates({
      history: [{ id: content, role: 'user', content, createdAt: new Date('2026-11-02T01:00:00.000Z') }],
      now: new Date('2026-11-02T02:00:00.000Z'),
    });
    assert.equal(state.topic, topic, content);
    assert.equal(state.status, 'PLANNED', content);
    assert.equal(state.startsAt, startsAt, content);
  }
});

test('a topic-specific cancellation cancels only that plan', () => {
  const states = extractRecentStates({
    history: [
      { id: 'work-plan', role: 'user', content: '明天上班', createdAt: new Date('2026-11-02T01:00:00.000Z') },
      { id: 'doctor-plan', role: 'user', content: '明天下午去医院', createdAt: new Date('2026-11-02T01:10:00.000Z') },
      { id: 'doctor-cancel', role: 'user', content: '明天下午不去医院了', createdAt: new Date('2026-11-02T01:20:00.000Z') },
    ],
    now: new Date('2026-11-02T02:00:00.000Z'),
  });
  assert.equal(states.find(state => state.topic === '就医').status, 'CANCELLED');
  assert.equal(states.find(state => state.topic === '工作').status, 'PLANNED');
  assert.equal(states.length, 2);
});

test('a generic cancellation cancels only the latest active state', () => {
  const states = extractRecentStates({
    history: [
      { id: 'work-plan', role: 'user', content: '明天上班', createdAt: new Date('2026-11-02T01:00:00.000Z') },
      { id: 'home-plan', role: 'user', content: '周末回家', createdAt: new Date('2026-11-02T01:10:00.000Z') },
      { id: 'cancel', role: 'user', content: '计划取消了', createdAt: new Date('2026-11-02T01:20:00.000Z') },
    ],
    now: new Date('2026-11-02T02:00:00.000Z'),
  });
  assert.equal(states.find(state => state.topic === '行程').status, 'CANCELLED');
  assert.equal(states.find(state => state.topic === '工作').status, 'PLANNED');
});

test('runtime context hides closed, expired, and cancelled states', () => {
  assert.equal(buildRecentStateRuntimeContext({ states: [
    { topic: '吃饭', value: '吃完了', status: 'CLOSED' },
    { topic: '通勤', value: '早上在车上', status: 'EXPIRED' },
    { topic: '就医', value: '不去医院了', status: 'CANCELLED' },
  ] }), '');
});

test('space chat injects continuity guidance for native and Pi runtimes', async () => {
  const [route, session] = await Promise.all([
    readFile(path.join(root, 'app/api/spaces/[spaceId]/messages/route.ts'), 'utf8'),
    readFile(path.join(root, 'lib/pi-runtime/space-session.mjs'), 'utf8'),
  ]);
  assert.match(route, /buildConversationContinuityGuidance/);
  assert.match(route, /continuityGuidance/);
  assert.match(session, /options\.continuityGuidance/);
});
