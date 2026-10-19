import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeChatBody } from './chat-stream.mjs';

test('decodes split UTF-8 NDJSON chunks and reports status separately', async () => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode('{"type":"status","label":"正在搜索"}\n{"type":"text_delta","text":"你好"}\n{"type":"status","label":""}');
  const response = new Response(new ReadableStream({ start(controller) {
    for (let index = 0; index < bytes.length; index += 1) controller.enqueue(bytes.slice(index, index + 1));
    controller.close();
  } }), { headers: { 'x-chat-stream-format': 'ndjson' } });
  const statuses = [];
  assert.equal(await new Response(decodeChatBody(response, (status) => statuses.push(status))).text(), '你好');
  assert.deepEqual(statuses, ['正在搜索', '', '']);
});

test('stream errors reach the caller and old plain text streams remain supported', async () => {
  const response = new Response('{"type":"error","error":"模型失败"}\n', { headers: { 'x-chat-stream-format': 'ndjson' } });
  await assert.rejects(new Response(decodeChatBody(response)).text(), /模型失败/);
  const plain = new Response('旧响应');
  assert.equal(decodeChatBody(plain), plain.body);
});

test('companion cues stay out of dialogue and remain optional for ordinary consumers', async () => {
  const data = '{"type":"text_delta","text":"你好"}\n{"type":"companion_cue","emotion":"shy"}\n';
  const cues = [];
  const response = () => new Response(data, { headers: { 'x-chat-stream-format': 'ndjson' } });
  assert.equal(await new Response(decodeChatBody(response(), undefined, emotion => cues.push(emotion))).text(), '你好');
  assert.deepEqual(cues, ['shy']);
  assert.equal(await new Response(decodeChatBody(response())).text(), '你好');
});

test('cancelling the decoded stream cancels the upstream request', async () => {
  let finishCancellation;
  const cancelled = new Promise((resolve) => { finishCancellation = resolve; });
  const response = new Response(new ReadableStream({ cancel() { finishCancellation(true); } }), { headers: { 'x-chat-stream-format': 'ndjson' } });
  await decodeChatBody(response).cancel();
  assert.equal(await cancelled, true);
});
