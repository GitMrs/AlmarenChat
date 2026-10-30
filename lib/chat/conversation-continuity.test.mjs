import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConversationContinuityGuidance, classifyConversationContinuity } from './conversation-continuity.mjs';

const at = (minutes) => new Date(Date.parse('2026-10-30T00:00:00.000Z') + minutes * 60_000);

test('explicit continuation wins over a long gap', () => {
  const result = classifyConversationContinuity({
    message: '那后来呢？',
    history: [{ role: 'user', content: '你找到饺子了吗', createdAt: at(0) }],
    now: at(180),
  });
  assert.equal(result.state, 'continue');
  assert.match(buildConversationContinuityGuidance({ message: '那后来呢？', history: [{ role: 'user', content: '你找到饺子了吗', createdAt: at(0) }], now: at(180) }), /明确延续/);
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
