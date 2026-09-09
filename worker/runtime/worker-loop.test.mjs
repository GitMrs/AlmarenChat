import assert from 'node:assert/strict';
import test from 'node:test';
import { runWorkerIteration } from './worker-loop.mjs';

function harness(overrides = {}) {
  const calls = [];
  return {
    calls,
    options: {
      recover: () => calls.push('recover'),
      triggerAutomation: () => calls.push('trigger-automation'),
      claimCompletion: () => null,
      deliverCompletion: () => calls.push('deliver'),
      failCompletion: () => calls.push('fail-completion'),
      claimConnectorExecution: () => null,
      processConnectorExecution: async () => calls.push('process-connector-action'),
      claimRun: () => null,
      processRun: async () => calls.push('process-run'),
      heartbeatRun: () => calls.push('heartbeat'),
      releaseRun: () => calls.push('release-run'),
      claimDiscussion: () => null,
      processDiscussion: async () => calls.push('process-discussion'),
      claimRelay: () => null,
      processRelay: async () => calls.push('process-relay'),
      heartbeatIntervalMs: 5_000,
      delay: async () => calls.push('delay'),
      setIntervalFn: () => ({ unref: () => calls.push('unref') }),
      clearIntervalFn: () => calls.push('clear-heartbeat'),
      ...overrides,
    },
  };
}

test('completion delivery has priority over runs and discussions', async () => {
  const state = harness({
    claimCompletion: () => ({ id: 'completion-1' }),
    deliverCompletion: () => state.calls.push('deliver'),
    claimRun: () => {
      state.calls.push('claim-run');
      return { id: 'run-1' };
    },
  });
  assert.equal(await runWorkerIteration(state.options), 'completion');
  assert.deepEqual(state.calls, ['recover', 'trigger-automation', 'deliver']);
});

test('run processing always clears heartbeat and releases its lease', async () => {
  const state = harness({
    claimRun: () => ({ id: 'run-1' }),
    processRun: async () => {
      state.calls.push('process-run');
      throw new Error('execution failed');
    },
  });
  await assert.rejects(() => runWorkerIteration(state.options), /execution failed/);
  assert.deepEqual(state.calls, ['recover', 'trigger-automation', 'unref', 'process-run', 'clear-heartbeat', 'release-run']);
});

test('approved connector actions run before model tasks', async () => {
  const state = harness({
    claimConnectorExecution: () => ({ id: 'connector-action-1' }),
    claimRun: () => { state.calls.push('claim-run'); return { id: 'run-1' }; },
  });
  assert.equal(await runWorkerIteration(state.options), 'connector-action');
  assert.deepEqual(state.calls, ['recover', 'trigger-automation', 'process-connector-action']);
});

test('discussion runs only when no completion or task run is available', async () => {
  const state = harness({
    claimDiscussion: () => ({ id: 'discussion-1' }),
  });
  assert.equal(await runWorkerIteration(state.options), 'discussion');
  assert.deepEqual(state.calls, ['recover', 'trigger-automation', 'process-discussion']);
});

test('relay runs only when higher-priority work is unavailable', async () => {
  const state = harness({
    claimRelay: () => ({ id: 'relay-1' }),
  });
  assert.equal(await runWorkerIteration(state.options), 'relay');
  assert.deepEqual(state.calls, ['recover', 'trigger-automation', 'process-relay']);
});

test('idle iteration waits before polling again', async () => {
  const state = harness();
  assert.equal(await runWorkerIteration(state.options), 'idle');
  assert.deepEqual(state.calls, ['recover', 'trigger-automation', 'delay']);
});
