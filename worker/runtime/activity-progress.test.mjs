import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelProgressCallbacks, trackToolExecution } from './activity-progress.mjs';

test('reasoning flush preserves trailing deltas and resets counts between provider attempts', () => {
  const events = [];
  let time = 0;
  const progress = createModelProgressCallbacks({ emit: (...event) => events.push(event), runId: 'r', taskId: 't', agentName: '前端', now: () => time });
  progress.onReasoningDelta('开头');
  time = 100;
  progress.onReasoningDelta('结尾');
  assert.equal(events.length, 1);
  progress.flush();
  assert.equal(events[1][3].preview, '开头结尾');
  assert.equal(events[1][3].final, true);
  assert.equal(events[0][3].requestId, events[1][3].requestId);
  progress.flush();
  assert.equal(events.length, 2);
  progress.reset();
  progress.onReasoningDelta('重试');
  assert.notEqual(events[2][3].requestId, events[1][3].requestId);
  assert.equal(events[2][3].reasoningContentChars, 2);
  progress.flush();
});

test('tool lifecycle pairs success, returned errors and thrown errors without changing results', async () => {
  const events = [];
  const identity = { emit: (...event) => events.push(event), runId: 'r', taskId: 't', agentName: '前端' };
  const value = { ok: true };
  assert.equal(await trackToolExecution(identity, async () => value)('check_files', { paths: ['a.html'] }), value);
  assert.equal(events[0][3].toolCallId, events[1][3].toolCallId);
  assert.deepEqual(events[1][3].paths, ['a.html']);
  assert.equal(events[1][3].failed, false);
  await trackToolExecution(identity, async () => ({ ok: false, error: '校验失败' }))('run_check', {});
  assert.equal(events[3][3].failed, true);
  assert.equal(events[3][3].error, '校验失败');
  await assert.rejects(trackToolExecution(identity, async () => { throw new Error('文件不存在'); })('read_file', { path: 'missing' }), /文件不存在/);
  assert.equal(events[5][3].failed, true);
  assert.notEqual(events[3][3].toolCallId, events[5][3].toolCallId);
});

test('failed file validation is shown as failure even without an ok flag', async () => {
  const events = [];
  await trackToolExecution({ emit: (...event) => events.push(event) }, async () => ({ valid: false, issues: ['资源缺失'] }))('check_files', {});
  assert.equal(events[1][3].failed, true);
  assert.equal(events[1][3].error, '资源缺失');
});
