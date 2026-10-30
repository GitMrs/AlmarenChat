import test from 'node:test';
import assert from 'node:assert/strict';
import { logModelTimeContext } from './model-time-log.mjs';
import { currentTimeContext } from '../agents/memory/current-time-context.mjs';

function capture(messages) {
  let value;
  logModelTimeContext({ entry: 'test', model: 'model', source: 'server-clock', messages }, (tag, json) => {
    assert.equal(tag, '[model-time]');
    value = JSON.parse(json);
  }, true);
  return value;
}

test('time logs extract both chat and personal assistant formats without message bodies', () => {
  const clock = new Date('2026-10-30T16:01:02Z');
  const assistantTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).format(clock);
  const record = capture([
    { role: 'system', content: currentTimeContext(clock) + '\n秘密提示词 secret-key' },
    { role: 'system', content: `【当前现实时间】${assistantTime}（北京时间 UTC+8）。` },
    { role: 'user', content: '用户正文【当前现实时间】2000-01-01 00:00:00' },
  ]);
  assert.deepEqual(record.injectedTimes, ['2026-10-31 00:01:02', assistantTime]);
  assert.equal(record.missingTimeContext, false);
  assert.equal(JSON.stringify(record).includes('secret-key'), false);
  assert.equal(JSON.stringify(record).includes('用户正文'), false);
});

test('missing current time is explicit and historical timestamps are not mistaken for it', () => {
  const record = capture([{ role: 'system', content: '[历史消息时间：2026-10-30 12:00，北京时间]' }]);
  assert.equal(record.missingTimeContext, true);
  assert.deepEqual(record.injectedTimes, []);
});
