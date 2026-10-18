import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { advancePlayback, applyMotion, sampleCurve, blendSnapshot, advanceLookAt, createLookAtState } from './motion.ts';
import { KoroModel } from './vendor/koro-core.js';
import { companionCharacters } from './catalog.ts';
import { PhysicsPlayer } from './physics.ts';

const assets = new URL('../../public/companion/models/nari/', import.meta.url);
const json = async relative => JSON.parse(await readFile(new URL(relative, assets), 'utf8'));

test('motion curves support linear, Bezier, stepped and inverse stepped segments', () => {
  assert.equal(sampleCurve([0, 2, 0, 2, 6], 1), 4);
  assert.equal(sampleCurve([0, 2, 2, 2, 6], 1), 2);
  assert.equal(sampleCurve([0, 2, 3, 2, 6], 1), 6);
  assert.equal(sampleCurve([0, 2, 0, 2, 6], -1), 2);
  assert.equal(sampleCurve([0, 2, 0, 2, 6], 5), 6);
  assert.ok(Math.abs(sampleCurve([0, 0, 1, 0.1, 0, 0.2, 1, 1, 1], 0.2375) - 0.5) < 0.00001);
});

test('playback loops at the boundary and holds the last frame when looping is off', () => {
  assert.deepEqual(advancePlayback(4, 1.5, 5, true), { time: 0.5, ended: false });
  assert.deepEqual(advancePlayback(4, 1.5, 5, false), { time: 5, ended: true });
  assert.deepEqual(advancePlayback(4, 1, 5, true), { time: 0, ended: false });
  assert.deepEqual(advancePlayback(0, 1, 0, true), { time: 0, ended: true });
});

test('exported surprised motion reproduces the supplied head angle and neutral ending', async () => {
  const motion = await json('Nari/motions/Nari_mood_surprised_lean.komo.json');
  const angle = motion.Curves.find(curve => curve.Id === 'ParamAngleZ');
  assert.equal(motion.Meta.Duration, 5.04);
  assert.ok(Math.abs(sampleCurve(angle.Segments, 0.9) - 21.7071) < 0.001);
  assert.ok(Math.abs(sampleCurve(angle.Segments, 5.04)) < 0.001);
});

test('motion snapshot blending applies smoothstep S-curve without overshoot', () => {
  const from = [10, 20, -30];
  const target = [0, 0, 0];

  const atZero = [...target];
  blendSnapshot(atZero, from, 0);
  assert.deepEqual(atZero, [10, 20, -30]);

  const atHalf = [...target];
  blendSnapshot(atHalf, from, 0.5);
  assert.deepEqual(atHalf, [5, 10, -15]);

  const atOne = [...target];
  blendSnapshot(atOne, from, 1);
  assert.deepEqual(atOne, [0, 0, 0]);

  // Out-of-bounds progress is clamped safely
  const clampedBelow = [...target];
  blendSnapshot(clampedBelow, from, -0.5);
  assert.deepEqual(clampedBelow, [10, 20, -30]);

  const clampedAbove = [...target];
  blendSnapshot(clampedAbove, from, 1.5);
  assert.deepEqual(clampedAbove, [0, 0, 0]);
});

test('look-at tracking smoothly converges to pointer and applies clamped model offsets', () => {
  const state = createLookAtState();
  state.targetX = 1;
  state.targetY = -1;

  advanceLookAt(state, 0.1, 7.5);
  assert.ok(state.currentX > 0.4 && state.currentX < 0.6, `currentX=${state.currentX} expected ~0.52`);
  assert.ok(state.currentY < -0.4 && state.currentY > -0.6, `currentY=${state.currentY} expected ~-0.52`);

  // Multiple steps converge towards target
  for (let step = 0; step < 10; step++) advanceLookAt(state, 0.1, 7.5);
  assert.ok(Math.abs(state.currentX - 1) < 0.001);
  assert.ok(Math.abs(state.currentY - -1) < 0.001);
});


for (const character of companionCharacters) {
  if (character.engine === 'cubism') {
    test(`${character.name} cubism 3/4 assets resolve and model definition is valid`, async () => {
      const characterAssets = new URL(`../../public${character.modelRoot}/`, import.meta.url);
      const characterJson = async relative => JSON.parse(await readFile(new URL(relative, characterAssets), 'utf8'));
      assert.ok(character.modelFile, 'cubism model must define modelFile');
      const modelJson = await characterJson(character.modelFile);
      assert.ok(modelJson.FileReferences?.Moc, 'cubism model must have moc reference');
      assert.ok(modelJson.FileReferences?.Textures?.length > 0, 'cubism model must have texture references');
      for (const tex of modelJson.FileReferences.Textures) {
        const texBytes = await readFile(new URL(tex, characterAssets));
        assert.ok(texBytes.length > 0, `Texture ${tex} must exist`);
      }
      assert.ok(character.motions.length > 0, 'cubism model must have motions');
      for (const m of character.motions) {
        assert.ok(m.cubismGroup !== undefined, `Motion ${m.id} must define cubismGroup`);
        assert.ok(typeof m.cubismIndex === 'number', `Motion ${m.id} must define cubismIndex`);
      }
    });
    continue;
  }

  test(`${character.name} assets resolve and real motions deform finite mesh vertices`, async () => {
  const characterAssets = new URL(`../../public${character.modelRoot}/`, import.meta.url);
  const characterJson = async relative => JSON.parse(await readFile(new URL(relative, characterAssets), 'utf8'));
  const rig = await characterJson(character.rig);
  const bytes = await readFile(new URL(character.binary, characterAssets));
  const binary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const graphics = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2,
    createProgram: () => ({}), createShader: () => ({}),
    shaderSource() {}, compileShader() {}, attachShader() {}, linkProgram() {}, deleteShader() {},
    getShaderParameter: () => true, getProgramParameter: () => true,
    getAttribLocation: () => 0, getUniformLocation: () => ({}),
  };
  const model = new KoroModel(graphics, rig, binary, []);
  model.applyTuning(await characterJson(character.tuning));
  if (character.pose) model.applyPose(await characterJson(character.pose));
  const physicsData = character.physics ? await characterJson(character.physics) : null;
  const physics = physicsData ? new PhysicsPlayer(physicsData, character.physicsWindSettings) : null;
  const baseOpacity = new Float32Array(model.partOpacity);
  const assetFolder = character.assetDir ?? (character.rig ? character.rig.split('/')[0] : character.name);
  const motionFiles = (await readdir(characterAssets, { recursive: true })).filter(path => path.endsWith('.komo.json')).sort();
  assert.deepEqual(character.motions.map(entry => entry.path ?? `${assetFolder}/motions/${entry.id}.komo.json`).sort(), motionFiles, 'catalog must include every motion resource exactly once');
  const expressionFiles = (await readdir(new URL(`${assetFolder}/expressions/`, characterAssets))).filter(path => path.endsWith('.koexp.json')).sort();
  assert.deepEqual(character.expressions.filter(entry => entry.id).map(entry => `${entry.id}.koexp.json`).sort(), expressionFiles, 'catalog must include every expression');
  for (const texture of character.textures) assert.ok((await readFile(new URL(texture, characterAssets))).length > 0);
  for (const expression of character.expressions) {
    if (!expression.id) continue;
    const data = await characterJson(`${assetFolder}/expressions/${expression.id}.koexp.json`);
    for (const parameter of data.params) assert.ok(model.paramIndex.has(parameter.id), `${expression.id}: ${parameter.id}`);
  }
  physics?.settle(model);
  model.update();
  const initial = rig.art_meshes.flatMap(mesh => [...mesh._world]);
  let greatestDisplacement = 0;
  for (const entry of character.motions) {
    const motion = await characterJson(entry.path ?? `${assetFolder}/motions/${entry.id}.komo.json`);
    let motionDisplacement = 0;
    for (const fraction of [0, 0.18, 0.5, 0.8, 1]) {
      rig.parameters.forEach((parameter, index) => { model.params[index] = parameter.default; });
      model.partOpacity.set(baseOpacity);
      applyMotion(model, motion, motion.Meta.Duration * fraction);
      physics?.settle(model);
      model.update();
      let cursor = 0;
      for (const mesh of rig.art_meshes) {
        assert.ok(Number.isFinite(mesh._opacity), entry.id);
        for (const coordinate of mesh._world) {
          assert.ok(Number.isFinite(coordinate), entry.id);
          motionDisplacement = Math.max(motionDisplacement, Math.abs(coordinate - initial[cursor++]));
        }
      }
    }
    assert.ok(motionDisplacement > 0.001, `${entry.id} must deform actual geometry`);
    greatestDisplacement = Math.max(greatestDisplacement, motionDisplacement);
  }
  assert.equal(rig.art_meshes.length, character.id === 'nari' ? 197 : 650);
  assert.ok(greatestDisplacement > 0.01, 'motion must deform actual geometry');
  if (character.id === 'yume') {
    rig.parameters.forEach((parameter, index) => { model.params[index] = parameter.default; });
    const windPhysics = new PhysicsPlayer(physicsData, character.physicsWindSettings);
    windPhysics.settle(model);
    model.update();
    const legMeshes = rig.art_meshes.filter(mesh => ['ArtMesh431', 'ArtMesh435', 'ArtMesh463', 'ArtMesh457'].includes(mesh.id));
    assert.equal(legMeshes.length, 4);
    const neutralLegs = legMeshes.map(mesh => [...mesh._world]);
    const windSource = { ...physicsData.Meta.EffectiveForces.Wind };
    let hairMovement = 0;
    for (let frame = 0; frame < 180; frame++) {
      const time = frame / 30;
      rig.parameters.forEach((parameter, index) => { model.params[index] = parameter.default; });
      windPhysics.setWind({ X: Math.sin(time * 1.5) * 0.12 + Math.sin(time * 2.8) * 0.05, Y: Math.cos(time * 1.1) * 0.03 });
      windPhysics.update(model, 1 / 30);
      model.update();
      for (const id of ['ParamBodyX', 'ParamBodyCrouchY', 'ParamBodyCore', 'ParamBodyZ', 'ParamBodyZ2']) {
        assert.ok(Math.abs(model.getParameter(id)) < 0.000001, `ambient wind must not drive ${id}`);
      }
      for (const [meshIndex, mesh] of legMeshes.entries()) {
        mesh._world.forEach((value, index) => assert.ok(Math.abs(value - neutralLegs[meshIndex][index]) < 0.000001, 'ambient wind must not bend either leg'));
      }
      hairMovement = Math.max(hairMovement, Math.abs(model.getParameter('ParamHairF1')));
    }
    assert.ok(hairMovement > 0.01, 'hair must still respond to ambient wind');
    assert.deepEqual(physicsData.Meta.EffectiveForces.Wind, windSource, 'runtime wind must not mutate the model configuration');
  }
  if (physics) {
    const testParams = character.id === 'nari'
      ? ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ']
      : ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ'];
    for (const id of testParams) {
      rig.parameters.forEach((parameter, index) => { model.params[index] = parameter.default; });
      physics.settle(model);
      model.update();
      const neutral = rig.art_meshes.map(mesh => [...mesh._world]);
      model.setParameter(id, 10);
      physics.settle(model);
      model.update();
      let displacement = 0;
      for (const [meshIndex, mesh] of rig.art_meshes.entries()) {
        if (mesh._opacity < 0.01) continue;
        for (const [coordinateIndex, coordinate] of mesh._world.entries()) {
          displacement = Math.max(displacement, Math.abs(coordinate - neutral[meshIndex][coordinateIndex]));
        }
      }
      assert.ok(displacement > 0.001, `${id} must move visible geometry through physics, got ${displacement}`);
      if (id === 'ParamAngleX' || id === 'ParamAngleY') {
        const output = character.id === 'nari'
          ? (id === 'ParamAngleX' ? 'ParamAngleX2' : 'ParamAngleY2')
          : (id === 'ParamAngleX' ? 'ParamHeadAngleX' : 'ParamHeadAngleY');
        assert.ok(model.getParameter(output) > 1, `${id}=10 must drive positive ${output}, got ${model.getParameter(output)}`);
      }
    }
    const beforePause = [...model.params];
    physics.update(model, 0);
    assert.deepEqual([...model.params], beforePause, 'paused physics must preserve its output');
  }
});
}
