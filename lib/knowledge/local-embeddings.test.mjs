import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

async function loadEmbeddings({ pipeline, existsSync = () => false, env = {} }) {
  const source = await readFile(new URL('./local-embeddings.ts', import.meta.url), 'utf8');
  const exports = {};
  const transformers = { env: { cacheDir: '/model-cache' }, pipeline };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, {
    exports,
    console,
    process: { env },
    Function: function () { return async () => transformers; },
    require(name) {
      if (name === 'node:fs') return { existsSync };
      if (name === 'node:path') return path;
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exports;
}

const embeddingPipeline = async () => ({ data: new Float32Array([0.5, 0.25]) });

test('loads complete cached model files directly without a repository lookup', async () => {
  const calls = [];
  const { embedText } = await loadEmbeddings({
    existsSync: () => true,
    pipeline: async (task, model, options) => {
      calls.push({ task, model, options });
      return embeddingPipeline;
    },
  });
  assert.deepEqual(Array.from(await embedText('我是不是不够好')), [0.5, 0.25]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, path.join('/model-cache', 'Xenova/bge-small-zh-v1.5'));
  assert.equal(calls[0].options.local_files_only, true);
});

test('incomplete tokenizer cache goes straight to the repository loader', async () => {
  const calls = [];
  const { embedText } = await loadEmbeddings({
    existsSync: (file) => path.basename(file) === 'config.json',
    pipeline: async (_task, model) => { calls.push(model); return embeddingPipeline; },
  });
  await embedText('测试');
  assert.deepEqual(calls, ['Xenova/bge-small-zh-v1.5']);
});

test('missing cached weights fall back to downloading the configured precision', async () => {
  const calls = [];
  const { embedText } = await loadEmbeddings({
    existsSync: () => true,
    env: { EMBED_DTYPE: 'q8' },
    pipeline: async (_task, model, options) => {
      calls.push({ model, options });
      if (options.local_files_only) throw new Error('Quantized weights not cached');
      return embeddingPipeline;
    },
  });
  await embedText('测试');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].model, 'Xenova/bge-small-zh-v1.5');
  assert.equal(calls[1].options.dtype, 'q8');
  assert.equal(calls[1].options.local_files_only, undefined);
});

test('concurrent searches share the same model initialization', async () => {
  let resolveLoad;
  let loads = 0;
  const { embedText } = await loadEmbeddings({
    pipeline: () => {
      loads++;
      return new Promise((resolve) => { resolveLoad = resolve; });
    },
  });
  const requests = [embedText('问题一'), embedText('问题二')];
  await new Promise(setImmediate);
  assert.equal(loads, 1);
  resolveLoad(embeddingPipeline);
  await Promise.all(requests);
  await embedText('问题三');
  assert.equal(loads, 1);
});

test('a failed initialization does not prevent the next search from retrying', async () => {
  let loads = 0;
  const { embedText } = await loadEmbeddings({
    pipeline: async () => {
      if (++loads === 1) throw new Error('Download failed');
      return embeddingPipeline;
    },
  });
  await assert.rejects(embedText('第一次'), /Download failed/);
  assert.deepEqual(Array.from(await embedText('重试')), [0.5, 0.25]);
  assert.equal(loads, 2);
});
