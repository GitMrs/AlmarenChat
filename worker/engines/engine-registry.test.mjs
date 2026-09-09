import assert from 'node:assert/strict';
import test from 'node:test';
import { createExecutionEngineRegistry } from './engine-registry.mjs';
import { createNativeExecutionEngine } from './native-engine.mjs';

test('native execution engine delegates executor requests without changing harness data', async () => {
  const calls = [];
  const manifest = { validation: { valid: true } };
  const engine = createNativeExecutionEngine({
    executeExecutor: async (options) => {
      calls.push(options);
      return { result: 'executor result', paused: false, manifest };
    },
  });

  const request = { mode: 'executor', run: { id: 'run-1' }, task: { id: 'task-1' } };
  const result = await engine.execute(request);

  assert.deepEqual(calls, [{ run: request.run, task: request.task }]);
  assert.deepEqual(result, {
    result: 'executor result',
    paused: false,
    manifest,
    status: 'completed',
    engineId: 'native',
    engineVersion: '1',
  });
});

test('native execution engine normalizes advisor results', async () => {
  const engine = createNativeExecutionEngine({
    executeAdvisor: async ({ task }) => `advice for ${task.id}`,
  });

  const result = await engine.execute({ mode: 'advisor', task: { id: 'task-2' } });

  assert.equal(result.status, 'completed');
  assert.equal(result.result, 'advice for task-2');
  assert.equal(result.paused, false);
  assert.equal(result.engineId, 'native');
});

test('native execution engine rejects unknown task modes before calling a harness', async () => {
  let called = false;
  const engine = createNativeExecutionEngine({
    executeExecutor: async () => { called = true; },
  });

  await assert.rejects(() => engine.execute({ mode: 'publisher' }), /Unsupported agent execution mode/);
  assert.equal(called, false);
});

test('execution engine registry resolves the default engine and rejects unknown engines', async () => {
  const calls = [];
  const native = {
    id: 'native',
    version: 'test',
    execute: async (request) => {
      calls.push(request);
      return { status: 'completed' };
    },
  };
  const registry = createExecutionEngineRegistry([native], { defaultEngineId: 'native' });

  assert.deepEqual(registry.ids(), ['native']);
  assert.equal(registry.resolve(), native);
  assert.deepEqual(await registry.execute({ mode: 'executor' }), { status: 'completed' });
  assert.deepEqual(calls, [{ mode: 'executor' }]);
  assert.throws(() => registry.resolve('pi'), /not registered: pi/);
  assert.throws(() => registry.execute({ mode: 'executor' }, 'native', '2'), /native@2/);
});
