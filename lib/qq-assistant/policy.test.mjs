import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyQQCommand,
  qqImageAttachments,
  qqReminderRetryDelayMs,
  qqWebSearchEnabled,
} from './policy.mjs';

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

test('QQ web search switch is read from message scene ext', () => {
  assert.equal(qqWebSearchEnabled(['msg_idx=abc', 'web_search=1']), true);
  assert.equal(qqWebSearchEnabled([' web_search = 1 ']), true);
  assert.equal(qqWebSearchEnabled(['web_search=0']), false);
  assert.equal(qqWebSearchEnabled(['other=1']), false);
  assert.equal(qqWebSearchEnabled(undefined), false);
});

test('QQ image attachments only accept HTTPS images and are normalized', () => {
  assert.deepEqual(qqImageAttachments([
    { content_type: 'image/jpeg', url: 'https://example.qq.com/a.jpg', filename: 'a.jpg', size: 123 },
    { content_type: 'video/mp4', url: 'https://example.qq.com/a.mp4' },
    { content_type: 'image/png', url: 'http://example.qq.com/a.png' },
  ]), [{
    type: 'image',
    url: 'https://example.qq.com/a.jpg',
    mimeType: 'image/jpeg',
    name: 'a.jpg',
    size: 123,
  }]);
  assert.equal(qqImageAttachments(Array.from({ length: 6 }, (_, index) => ({
    mimeType: 'image/png',
    url: `https://example.qq.com/${index}.png`,
  }))).length, 4);
});
