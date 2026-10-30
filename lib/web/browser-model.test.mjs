import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { getReasoningDelta } from '../chat/reasoning.mjs';
import { stripHistoryRetrievalNotices } from '../personal-assistant/retrieval-notice.mjs';

const source = await readFile(new URL('./browser-model.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const config = { source: 'OLLAMA', baseUrl: 'http://localhost:11434/v1', model: 'test', apiKey: '' };

function browserModel(data, onRequest = () => {}) {
  const exports = {};
  const requestLogs = [];
  vm.runInNewContext(output, {
    exports, ReadableStream, TextDecoder, TextEncoder,
    require: name => {
      if (name === '../chat/model-request-log.mjs') return { logModelRequest: ({ body }) => requestLogs.push(JSON.parse(JSON.stringify(body))) };
      if (name === '../chat/model-time-log.mjs') return { logModelTimeContext: () => {} };
      if (name === '../personal-assistant/retrieval-notice.mjs') return { stripHistoryRetrievalNotices };
      assert.equal(name, '../chat/reasoning.mjs');
      return { getReasoningDelta };
    },
    fetch: async (_url, options) => {
      onRequest(JSON.parse(options.body));
      const bytes = new TextEncoder().encode(data);
      return new Response(new ReadableStream({ start(controller) {
        for (let index = 0; index < bytes.length; index++) controller.enqueue(bytes.slice(index, index + 1));
        controller.close();
      } }));
    },
  });
  exports.requestLogs = requestLogs;
  return exports;
}

test('browser model splits reasoning from content across UTF-8 chunks and handles an unterminated last line', async () => {
  const model = browserModel('data: {"choices":[{"delta":{"reasoning_content":"先想"}}]}\r\n'
    + 'data: {"choices":[{"delta":{"reasoning":"再想","content":"答案"}}]}');
  const reasoning = [];
  const stream = await model.streamBrowserModel({ config, messages: [], onReasoning: delta => reasoning.push(delta) });
  assert.equal(await new Response(stream).text(), '答案');
  assert.deepEqual(reasoning, ['先想', '再想']);
});

test('Ollama removes only historical assistant source footers from the request', async () => {
  let request;
  const model = browserModel('data: {"choices":[{"delta":{"content":"新回复"}}]}\n', value => { request = value; });
  const content = '正文 [链接](https://example.com/body)\n\n---\n**查询来源**（查询时间：2026-10-27T00:00:00.000Z）\n\n1. [资料](<https://example.com>)';
  const messages = [{ role: 'user', content }, { role: 'assistant', content }];
  assert.equal(await model.completeBrowserModel({ config, messages }), '新回复');
  assert.equal(request.messages[0].content, content);
  assert.equal(request.messages[1].content, '正文 [链接](https://example.com/body)');
  assert.equal(messages[1].content, content);
});

test('browser completion callers without a reasoning callback still receive only the answer', async () => {
  const model = browserModel('data: {"choices":[{"delta":{"reasoning_content":"思考","content":"正文"}}]}\n'
    + 'data: [DONE]\n');
  assert.equal(await model.completeBrowserModel({ config, messages: [] }), '正文');
});


test('browser full request log matches the body actually sent after history cleanup', async () => {
  let sent;
  const model = browserModel('data: [DONE]\n', body => { sent = body; });
  const stream = await model.streamBrowserModel({ config, messages: [
    { role: 'system', content: '系统提示词' },
    { role: 'user', content: '本轮新对话' },
  ] });
  await new Response(stream).text();
  assert.deepEqual(model.requestLogs[0], sent);
});
