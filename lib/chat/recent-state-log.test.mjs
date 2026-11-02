import assert from 'node:assert/strict';
import test from 'node:test';
import { logRecentStateLifecycle } from './recent-state-log.mjs';

test('recent-state lifecycle logs contain identifiers but never message content', () => {
  const output = [];
  logRecentStateLifecycle({
    action: 'created', conversationId: 'conversation-1', sourceMessageId: 'message-1',
    topics: ['吃饭'], status: 'UNCONFIRMED', affected: 1, content: '我在吃饭',
  }, (...args) => output.push(args.join(' ')), true);

  assert.equal(output.length, 1);
  assert.match(output[0], /^\[recent-state\] /);
  assert.match(output[0], /"action":"created"/);
  assert.match(output[0], /"conversationId":"conversation-1"/);
  assert.doesNotMatch(output[0], /我在吃饭|content/);
});

test('recent-state lifecycle logs stay silent when debug logging is disabled', () => {
  const output = [];
  logRecentStateLifecycle({ action: 'created', conversationId: 'conversation-1' }, value => output.push(value), false);
  assert.equal(output.length, 0);
});
