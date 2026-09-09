import assert from 'node:assert/strict';
import test from 'node:test';
import { createPiExecutionEngine } from './pi-engine.mjs';

test('Pi execution engine converts a worker request into a Pi Session execution', async () => {
  const calls = [];
  const engine = createPiExecutionEngine({
    buildSessionOptions: async (request) => ({
      sessionKey: `task:${request.run.id}:${request.task.id}`,
      message: request.task.instruction,
    }),
    runSession: async (options) => {
      calls.push(options);
      return {
        content: 'Pi task result',
        sessionId: 'session-1',
        execution: { type: 'pi_execution', status: 'completed', tokens: { total: 12 } },
      };
    },
  });

  const result = await engine.execute({
    mode: 'executor',
    run: { id: 'run-1' },
    task: { id: 'task-1', instruction: 'create article.md' },
  });

  assert.deepEqual(calls, [{ sessionKey: 'task:run-1:task-1', message: 'create article.md' }]);
  assert.equal(result.status, 'completed');
  assert.equal(result.result, 'Pi task result');
  assert.equal(result.engineId, 'pi');
  assert.equal(result.engineVersion, '1');
  assert.equal(result.sessionId, 'session-1');
});

test('Pi execution engine preserves a cancelled Session outcome', async () => {
  const engine = createPiExecutionEngine({
    buildSessionOptions: () => ({ sessionKey: 'task:cancelled' }),
    runSession: async () => ({
      content: 'Pi 已取消本轮处理。',
      sessionId: 'session-2',
      execution: { type: 'pi_execution', status: 'cancelled' },
    }),
  });

  const result = await engine.execute({ mode: 'advisor' });
  assert.equal(result.status, 'cancelled');
});

test('Pi execution engine cannot be created without the Worker governance adapter', () => {
  assert.throws(() => createPiExecutionEngine(), /requires buildSessionOptions/);
});

test('Pi execution engine accepts structured completion state from Worker governance', async () => {
  const manifest = { entries: [{ path: 'article.md' }], validation: { valid: true } };
  const engine = createPiExecutionEngine({
    buildSessionOptions: () => ({
      sessionKey: 'task:structured',
      resolveExecutionResult: () => ({
        status: 'waiting',
        paused: true,
        result: '',
        manifest,
      }),
    }),
    runSession: async () => ({
      content: 'Pi 已完成本轮处理。',
      sessionId: 'session-3',
      execution: { type: 'pi_execution', status: 'completed' },
    }),
  });

  const result = await engine.execute({ mode: 'executor' });
  assert.equal(result.status, 'waiting');
  assert.equal(result.paused, true);
  assert.equal(result.result, '');
  assert.equal(result.manifest, manifest);
});
