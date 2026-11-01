import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { companionCharacters } from './catalog.ts';
import { nariBehavior } from './behaviors/nari.ts';
import { yumeBehavior } from './behaviors/yume.ts';

test('base head/face/body/hold selections use matching existing Fish recordings and avoid repeats', async () => {
  const source = await readFile(new URL('./voice.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('require', 'exports', compiled)(createRequire(new URL('./voice.ts', import.meta.url)), exports);
  for (const who of ['nari', 'yume']) {
    const manifest = JSON.parse(await readFile(new URL(`../../public/companion/audio/voice/${who}/manifest.json`, import.meta.url), 'utf8'));
    for (const kind of ['head', 'face', 'body', 'hold']) {
      let previous;
      for (let i = 0; i < 6; i++) {
        const line = exports.getTouchVoiceLine(who, kind, previous);
        assert.notEqual(line.text, previous);
        assert.equal(manifest.find(item => item.file === line.audioUrl)?.text, line.text);
        assert.ok((await readFile(new URL(`../../public${line.audioUrl}`, import.meta.url))).length > 500);
        previous = line.text;
      }
    }
  }
});

for (const behavior of [nariBehavior, yumeBehavior]) {
  const character = companionCharacters.find(c => c.id === behavior.id);
  test(`${character.id} protection subtitle matches an existing recorded line`, async () => {
    const { line } = behavior.getSurrenderReaction(character, '');
    assert.ok(line.audioUrl);
    const manifest = JSON.parse(await readFile(new URL(`../../public/companion/audio/voice/${character.id}/manifest.json`, import.meta.url), 'utf8'));
    assert.equal(manifest.find(item => item.file === line.audioUrl)?.text, line.text);
    assert.ok((await readFile(new URL(`../../public${line.audioUrl}`, import.meta.url))).length > 500);
  });
  for (const skin of character.skins.filter(s => s.id !== 'original')) {
    test(`${character.id}/${skin.id} tap tiers map to matching local recordings`, async () => {
      const { tapLines, tapReactions } = skin.interaction;
      assert.ok(tapReactions.rapid.length);
      const burst = new Set([...tapReactions.rapid, tapReactions.surrender]);
      assert.ok(burst.size < tapLines.length, 'normal tap pool must remain distinct');
      for (const region of ['head', 'face', 'body', 'hold']) assert.ok(skin.interaction.touchLines[region].length);
      for (const region of ['head', 'face', 'body']) {
        assert.ok(skin.interaction.touchLines[region].every(index => !burst.has(index)), 'normal regions must not reuse burst-only lines');
      }
      const selected = new Set([...burst, ...Object.values(skin.interaction.touchLines).flat()]);
      const manifest = JSON.parse(await readFile(new URL(`../../public/companion/audio/voice/${character.id}/skins/${skin.id}/manifest.json`, import.meta.url), 'utf8'));
      for (const index of selected) {
        assert.ok(Number.isInteger(index) && index >= 0 && index < tapLines.length);
        const file = `/companion/audio/voice/${character.id}/skins/${skin.id}/tap_${String(index + 1).padStart(2, '0')}.mp3`;
        assert.equal(manifest.find(item => item.file === file)?.text, tapLines[index], file);
        assert.ok((await readFile(new URL(`../../public${file}`, import.meta.url))).length > 500);
      }
    });
  }
}
