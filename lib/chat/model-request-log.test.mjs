import test from 'node:test';
import assert from 'node:assert/strict';
import { logModelRequest } from './model-request-log.mjs';

test('request logs include complete prompts, history, new messages and tool definitions', () => {
  const body = {
    model: 'test-model', stream: true,
    messages: [
      { role: 'system', content: '系统提示词\n【当前现实时间】2026-10-30 22:00:00' },
      { role: 'user', content: '旧问题' },
      { role: 'assistant', content: '旧回复' },
      { role: 'tool', tool_call_id: 'call', content: '工具返回结果' },
      { role: 'user', content: '新问题' },
    ],
    tools: [{ type: 'function', function: { name: 'read_file' } }],
  };
  let record;
  logModelRequest({ entry: 'server-chat', body }, (tag, json) => {
    assert.equal(tag, '[model-request]');
    record = JSON.parse(json);
  }, true);
  assert.deepEqual(record.request, body);
  assert.equal(record.entry, 'server-chat');
  assert.equal(record.toolCount, 1);
  assert.equal(record.toolSchemaChars, JSON.stringify(body.tools).length);
  assert.deepEqual(record.toolNames, ['read_file']);
});

test('space native and Pi logs count their actual nested tool schemas', () => {
  for (const body of [
    { request: { tools: [{ function: { name: 'read_file' } }] } },
    { context: { tools: [{ name: 'read_file', parameters: {} }] } },
  ]) {
    let record;
    logModelRequest({ entry: 'space', body }, (_tag, json) => { record = JSON.parse(json); }, true);
    assert.equal(record.toolCount, 1);
    assert.deepEqual(record.toolNames, ['read_file']);
  }
});
