import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { companionCharacters } from './catalog.ts';
import { KoroModel } from './vendor/koro-core.js';
import { applyMotion } from './motion.ts';

const graphics = {
  VERTEX_SHADER: 1, FRAGMENT_SHADER: 2,
  createProgram: () => ({}), createShader: () => ({}),
  shaderSource() {}, compileShader() {}, attachShader() {}, linkProgram() {}, deleteShader() {},
  getShaderParameter: () => true, getProgramParameter: () => true,
  getAttribLocation: () => 0, getUniformLocation: () => ({}),
};

for (const character of companionCharacters.filter(item => item.id === 'nari' || item.id === 'yume')) {
  for (const skin of character.skins.filter(item => item.id !== 'original')) {
    test(`${character.id}/${skin.id}: skin resources and motion geometry remain compatible`, async () => {
      const root = new URL(`../../public${skin.modelRoot}/`, import.meta.url);
      const json = async relative => JSON.parse(await readFile(new URL(relative, root), 'utf8'));
      const rig = await json(skin.rig);
      const index = await json('manifest.index.json');
      assert.deepEqual(skin.textures, index.textures, 'texture order must match the pack manifest');
      for (const texture of skin.textures) assert.ok((await readFile(new URL(texture, root))).length > 0);
      for (const mesh of rig.art_meshes) {
        assert.ok(Number.isInteger(mesh.texture) && mesh.texture >= 0 && mesh.texture < skin.textures.length, `invalid texture index: ${mesh.id}`);
      }
      const bytes = await readFile(new URL(skin.binary, root));
      const model = new KoroModel(graphics, rig, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), []);
      if (skin.tuning) model.applyTuning(await json(skin.tuning));
      if (skin.pose) model.applyPose(await json(skin.pose));
      const folder = skin.assetDir || character.assetDir || character.rig.split('/')[0];
      for (const entry of skin.motions || character.motions) {
        const file = entry.path || `${folder}/motions/${entry.id}.komo.json`;
        let motion;
        try { motion = await json(file); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          motion = JSON.parse(await readFile(new URL(`../../public${character.modelRoot}/${file}`, import.meta.url), 'utf8'));
        }
        for (const fraction of [0, 0.5, 1]) {
          rig.parameters.forEach((parameter, i) => { model.params[i] = parameter.default; });
          for (const [id, value] of Object.entries(skin.nativeDefaults || {})) model.setParameter(id, value);
          applyMotion(model, motion, motion.Meta.Duration * fraction);
          model.update();
          for (const mesh of rig.art_meshes) {
            assert.ok(Number.isFinite(mesh._opacity), `${entry.id}: invalid opacity`);
            assert.ok(Array.from(mesh._world).every(Number.isFinite), `${entry.id}: invalid vertices`);
          }
        }
      }
    });
  }
}
