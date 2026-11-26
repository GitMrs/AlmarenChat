import assert from 'node:assert/strict';
import test from 'node:test';
import { closingHandoff } from './chat-turn-recipient.mjs';

test('a clarification pauses even when the user is asked about a quoted handoff', () => {
  assert.equal(closingHandoff('这句话是指哪个方案？\n@雷震 审核上一份', true), '');
});
test('a mention in earlier context does not hand off', () => {
  assert.equal(closingHandoff('此前 @雷震 提过风险。\n千分之三具体指什么？', false), '');
});
test('after clarification the model can directly mention the reviewer', () => {
  assert.equal(closingHandoff('按你刚确认的口径核算。\n\n@雷震 请复核仓位。\n', false), '@雷震 请复核仓位。');
});
