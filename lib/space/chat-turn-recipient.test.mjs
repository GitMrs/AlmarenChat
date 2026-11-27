import assert from 'node:assert/strict';
import test from 'node:test';
import { closingHandoff, needsUserBeforeRelay, omitPendingHandoffs } from './chat-turn-recipient.mjs';

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

test('plain text can pause queued members even if it ends in a peer mention', async () => {
  const reply = '52U 是净值还是保证金？\n@雷震 请审核';
  assert.equal(await needsUserBeforeRelay(reply, true, async messages => {
    assert.equal(messages[1].content, reply);
    return 'WAIT';
  }), true);
});

test('only a pending continuation needs a recipient check', async () => {
  assert.equal(await needsUserBeforeRelay('收到了。', false, () => assert.fail()), false);
  assert.equal(await needsUserBeforeRelay('@凌风 有何补充？', true, async () => 'CONTINUE'), false);
  assert.equal(await needsUserBeforeRelay('请确认。', true, async () => null), true);
});
