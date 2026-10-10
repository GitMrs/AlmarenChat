import assert from 'node:assert/strict';
import test from 'node:test';
import { createScheduler } from './scheduler.mjs';

test('scheduler prevents a task from re-entering while it is running', async () => {
  let resolveTask;
  let calls = 0;
  const scheduler = createScheduler({ name: 'test', pollMs: 1000 });
  scheduler.register('slow', async () => {
    calls += 1;
    await new Promise((resolve) => { resolveTask = resolve; });
  });

  const first = scheduler.runOnce();
  await scheduler.runOnce();
  assert.equal(calls, 1);
  resolveTask();
  await first;
});

test('scheduler isolates task failures', async () => {
  const calls = [];
  const scheduler = createScheduler({ name: 'test', pollMs: 1000, logger: { warn() {} } });
  scheduler.register('failed', async () => { throw new Error('expected'); });
  scheduler.register('next', async () => calls.push('next'));

  await scheduler.runOnce();
  assert.deepEqual(calls, ['next']);
});
