import test from 'node:test';
import assert from 'node:assert/strict';
import { hitCharacter } from './touch-hit.mjs';
import { readFile } from 'node:fs/promises';
import { companionCharacters } from './catalog.ts';
import { KoroModel } from './vendor/koro-core.js';

const bounds = { minimumX: -0.5, maximumX: 0.5, minimumY: 0, maximumY: 2 };
const mesh = { _opacity: 1, _world: new Float32Array([-0.5, 0, 0.5, 0, 0.5, 2, -0.5, 2]), _idx: new Int16Array([0, 1, 2, 0, 2, 3]) };
function camera(xScale, yScale, offsetY = 1, offsetX = 0) {
  const matrix = new Float32Array(16);
  matrix[0] = xScale; matrix[5] = yScale; matrix[12] = offsetX; matrix[13] = offsetY;
  return matrix;
}
const screen = (projection, x, y) => ({ x: (projection[0] * x + projection[12] + 1) / 2, y: (1 - projection[5] * y - projection[13]) / 2 });

test('touch regions follow full/half/closeup/portrait and translated render projections', () => {
  for (const projection of [camera(1, -1), camera(2, -1), camera(2, -2), camera(4, -4), camera(1, -1, 2), camera(1, -1, 1, 0.2)]) {
    for (const [y, region] of [[0.1, 'head'], [0.4, 'face'], [0.7, 'body']]) {
      const point = screen(projection, 0.05, y);
      const visible = point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
      assert.equal(hitCharacter(point, projection, bounds, [mesh]), visible ? region : null);
    }
  }
});

test('empty canvas, invisible meshes and gaps between triangles do not count as touches', () => {
  const projection = camera(1, -1);
  assert.equal(hitCharacter({ x: 0.99, y: 0.5 }, projection, bounds, [mesh]), null);
  assert.equal(hitCharacter({ x: 0.5, y: 0.5 }, projection, bounds, [{ ...mesh, _opacity: 0 }]), null);
  const triangle = { ...mesh, _idx: new Int16Array([0, 1, 2]) };
  assert.equal(hitCharacter(screen(projection, -0.4, 1.8), projection, bounds, [triangle]), null);
  const moved = { ...mesh, _world: new Float32Array([1.5, 0, 2.5, 0, 2.5, 2, 1.5, 2]) };
  assert.equal(hitCharacter({ x: 0.5, y: 0.5 }, projection, bounds, [moved]), null);
});

test('unready projections, invalid coordinates, invalid indices and degenerate triangles are ignored', () => {
  const point = { x: 0.5, y: 0.5 }, projection = camera(1, -1);
  assert.equal(hitCharacter(point, new Float32Array(16), bounds, [mesh]), null);
  assert.equal(hitCharacter({ x: NaN, y: 0.5 }, projection, bounds, [mesh]), null);
  assert.equal(hitCharacter(point, projection, bounds, [{ ...mesh, _idx: new Int16Array([-1, 1, 2]) }]), null);
  assert.equal(hitCharacter(point, projection, bounds, [{ ...mesh, _idx: new Int16Array([0, 0, 0]) }]), null);
});

test('all Nari/Yume skin meshes expose hittable regions using the existing renderer geometry', async () => {
  const graphics = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, createProgram: () => ({}), createShader: () => ({}),
    shaderSource() {}, compileShader() {}, attachShader() {}, linkProgram() {}, deleteShader() {},
    getShaderParameter: () => true, getProgramParameter: () => true, getAttribLocation: () => 0, getUniformLocation: () => ({}),
  };
  for (const character of companionCharacters.filter(c => ['nari', 'yume'].includes(c.id))) {
    for (const skin of character.skins) {
      const root = new URL(`../../public${skin.modelRoot}/`, import.meta.url);
      const json = async file => JSON.parse(await readFile(new URL(file, root), 'utf8'));
      const rig = await json(skin.rig), bytes = await readFile(new URL(skin.binary, root));
      const model = new KoroModel(graphics, rig, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), []);
      if (skin.tuning) model.applyTuning(await json(skin.tuning));
      if (skin.pose) model.applyPose(await json(skin.pose));
      for (const [id, value] of Object.entries(skin.nativeDefaults || {})) model.setParameter(id, value);
      model.update();
      const points = rig.art_meshes.flatMap(m => Array.from(m._world));
      const xs = points.filter((_, i) => i % 2 === 0), ys = points.filter((_, i) => i % 2 === 1);
      const box = { minimumX: Math.min(...xs), maximumX: Math.max(...xs), minimumY: Math.min(...ys), maximumY: Math.max(...ys) };
      const projection = camera(1.6 / (box.maximumX - box.minimumX), -1.6 / (box.maximumY - box.minimumY));
      projection[12] = -(box.maximumX + box.minimumX) / 2 * projection[0];
      projection[13] = -(box.maximumY + box.minimumY) / 2 * projection[5];
      const found = new Map();
      for (const mesh of rig.art_meshes) {
        if (mesh._opacity <= 0.05) continue;
        for (let i = 0; i + 2 < mesh._idx.length && found.size < 3; i += 3) {
          const offsets = [mesh._idx[i], mesh._idx[i + 1], mesh._idx[i + 2]].map(n => (n & 65535) * 2);
          if (offsets.some(n => n + 1 >= mesh._world.length)) continue;
          const x = offsets.reduce((sum, n) => sum + mesh._world[n], 0) / 3;
          const y = offsets.reduce((sum, n) => sum + mesh._world[n + 1], 0) / 3;
          const region = hitCharacter(screen(projection, x, y), projection, box, [mesh]);
          if (region && !found.has(region)) found.set(region, screen(projection, x, y));
        }
      }
      assert.equal(found.size, 3, `${character.id}/${skin.id} should have all three model regions`);
      for (const [region, point] of found) assert.equal(hitCharacter(point, projection, box, rig.art_meshes), region);
      assert.equal(hitCharacter({ x: 0.01, y: 0.01 }, projection, box, rig.art_meshes), null);
    }
  }
});
