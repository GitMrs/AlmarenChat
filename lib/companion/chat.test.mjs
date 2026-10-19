import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { companionCharacters } from './catalog.ts';

const source = await readFile(new URL('../../app/api/companion/chat/route.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

function loadRoute({ apiKey = 'test-key', fail = false } = {}) {
  const exports = {};
  let content;
  vm.runInNewContext(output, { exports, console: { error() {} }, require: (name) => {
    if (name === 'next/server') return { NextResponse: { json: data => data } };
    if (name.endsWith('/db')) return { default: { user: { findUnique: async () => ({ apiKey }) } } };
    if (name.endsWith('/auth')) return { getUserIdFromRequest: () => 'test-user' };
    if (name.endsWith('/model-client')) return {
      resolveModelName: () => 'test-model',
      createModelClient: () => ({ chat: { completions: { create: async () => {
        if (fail) throw new Error('Model unavailable');
        return { choices: [{ message: { content } }] };
      } } } }),
    };
    if (name.endsWith('/tts')) return {};
    throw new Error(`Unexpected import: ${name}`);
  } });
  return async (characterId, expression) => {
    content = JSON.stringify({ reply: '你好', expression });
    return exports.POST({ json: async () => ({ characterId, message: '你好', speakVoice: false }) });
  };
}

async function assertExpressionExists(character, expression) {
  assert.equal(typeof expression, 'string');
  if (!expression) return;
  const root = new URL(`../../public${character.modelRoot}/`, import.meta.url);
  if (character.engine === 'cubism') {
    const model = JSON.parse(await readFile(new URL(character.modelFile, root), 'utf8'));
    const entry = model.FileReferences.Expressions?.find(item => item.Name === expression);
    assert.ok(entry, `${character.id}: missing expression ${expression}`);
    await readFile(new URL(entry.File, root));
  } else {
    await readFile(new URL(`${character.assetDir}/expressions/${expression}.koexp.json`, root));
  }
}

test('Cora preserves every supported expression ID, including natural expression', async () => {
  const post = loadRoute();
  const character = companionCharacters.find(item => item.id === 'yume');
  for (const { id } of character.expressions) {
    const result = await post(character.id, id);
    assert.equal(result.expression, id);
    await assertExpressionExists(character, result.expression);
  }
});

test('legacy, invalid and missing expression values always resolve to existing resources', async () => {
  const post = loadRoute();
  for (const character of companionCharacters) {
    for (const expression of ['微笑', '吃惊', '困倦', 'not-an-expression', undefined, null, 42]) {
      await assertExpressionExists(character, (await post(character.id, expression)).expression);
    }
  }
});

test('Mao accepts happy and surprised expressions and Laffey stays natural', async () => {
  const post = loadRoute();
  for (const expression of ['', '开心', '害羞', '生气', '惊讶']) {
    assert.equal((await post('mao', expression)).expression, expression);
  }
  for (const expression of ['', '通常', '困倦', '开心', '害羞']) {
    assert.equal((await post('lafei', expression)).expression, '');
  }
});

test('missing model keys and model failures never return another characters expression', async () => {
  for (const options of [{ apiKey: '' }, { fail: true }]) {
    const post = loadRoute(options);
    for (const character of companionCharacters) {
      await assertExpressionExists(character, (await post(character.id)).expression);
    }
  }
});
