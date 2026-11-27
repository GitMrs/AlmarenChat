import assert from 'node:assert/strict';
import test from 'node:test';
import { closingHandoff, omitPendingHandoffs } from './chat-turn-recipient.mjs';

test('a clarification pauses even when the user is asked about a quoted handoff', () => {
  assert.equal(closingHandoff('这句话是指哪个方案？\n@雷震 审核上一份', true), '');
});
test('a mention in earlier context does not hand off', () => {
  assert.equal(closingHandoff('此前 @雷震 提过风险。\n千分之三具体指什么？', false), '');
});
test('after clarification the model can directly mention the reviewer', () => {
  assert.equal(closingHandoff('按你刚确认的口径核算。\n\n@雷震 请复核仓位。\n', false), '@雷震 请复核仓位。');
});

test('pending handoffs can be omitted while keeping adjacent analysis and unrelated handles', () => {
  const tail = '@雷震 复核仓位\n\n支撑位仍待确认。\n@outlook 是示例账号\n';
  assert.equal(omitPendingHandoffs(tail, line => line.includes('@雷震')), '\n支撑位仍待确认。\n@outlook 是示例账号\n');
});
