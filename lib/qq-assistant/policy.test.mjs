import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyQQCommand, qqReminderRetryDelayMs } from './policy.mjs';

test('QQ new-conversation command is explicit', () => {
  assert.deepEqual(classifyQQCommand('/new'), { type: 'NEW_CONVERSATION' });
  assert.deepEqual(classifyQQCommand('我们聊个新话题'), { type: 'CHAT' });
});

test('QQ reminder commands only match short deterministic replies', () => {
  assert.deepEqual(classifyQQCommand('完成了'), { type: 'REMINDER_COMPLETE' });
  assert.deepEqual(classifyQQCommand('延后10分钟'), { type: 'REMINDER_SNOOZE', minutes: 10 });
  assert.deepEqual(classifyQQCommand('推迟2小时'), { type: 'REMINDER_SNOOZE', minutes: 120 });
  assert.deepEqual(classifyQQCommand('今天任务完成了不少'), { type: 'CHAT' });
});

test('QQ reminder retry backoff is bounded', () => {
  assert.equal(qqReminderRetryDelayMs(0), 30_000);
  assert.equal(qqReminderRetryDelayMs(99), 2 * 60 * 60_000);
});
