import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { getReasoningDelta } from '../chat/reasoning.mjs';

const source = await readFile(new URL('./browser-model.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const config = { source: 'OLLAMA', baseUrl: 'http://localhost:11434/v1', model: 'test', apiKey: '' };

function browserModel(data) {
  const exports = {};
  vm.runInNewContext(output, {
    exports, ReadableStream, TextDecoder, TextEncoder,
    require: name => {
      assert.equal(name, '../chat/reasoning.mjs');
      return { getReasoningDelta };
    },
    fetch: async () => {
      const bytes = new TextEncoder().encode(data);
      return new Response(new ReadableStream({ start(controller) {
        for (let index = 0; index < bytes.length; index++) controller.enqueue(bytes.slice(index, index + 1));
        controller.close();
      } }));
    },
  });
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

test('browser completion callers without a reasoning callback still receive only the answer', async () => {
  const model = browserModel('data: {"choices":[{"delta":{"reasoning_content":"思考","content":"正文"}}]}\n'
    + 'data: [DONE]\n');
  assert.equal(await model.completeBrowserModel({ config, messages: [] }), '正文');
});
