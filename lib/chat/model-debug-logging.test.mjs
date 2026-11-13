import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { logModelRequest } from './model-request-log.mjs';
import { logModelTimeContext } from './model-time-log.mjs';
import { toolDebugLogsEnabled } from './model-debug-logging.mjs';

const source = (await readFile(new URL('./model-debug-logging.mjs', import.meta.url), 'utf8')).replaceAll('export function', 'function');
function enabled(context) {
  return vm.runInNewContext(`${source}\nmodelDebugLogsEnabled()`, context);
}

test('server logging is off unless explicitly enabled', () => {
  assert.equal(enabled({ process: { env: {} } }), false);
  assert.equal(enabled({ process: { env: { ALMAREN_MODEL_DEBUG_LOGS: '0' } } }), false);
  assert.equal(enabled({ process: { env: { ALMAREN_MODEL_DEBUG_LOGS: '1' } } }), true);
});

test('browser logging requires its own opt-in and handles unavailable storage', () => {
  assert.equal(enabled({ window: { localStorage: { getItem: () => null } } }), false);
  assert.equal(enabled({ window: { localStorage: { getItem: () => '1' } } }), true);
  assert.equal(enabled({ window: { get localStorage() { throw new Error('disabled'); } } }), false);
});

test('tool logging requires a separate opt-in and never enables full model logging', () => {
  for (const env of [{}, { ALMAREN_MODEL_DEBUG_LOGS: '1' }, { ALMAREN_TOOL_DEBUG_LOGS: '0' }]) {
    assert.equal(vm.runInNewContext(`${source}\ntoolDebugLogsEnabled()`, { process: { env } }), false);
  }
  const context = { process: { env: { ALMAREN_TOOL_DEBUG_LOGS: '1' } } };
  assert.equal(vm.runInNewContext(`${source}\ntoolDebugLogsEnabled()`, context), true);
  assert.equal(enabled(context), false);
  assert.equal(vm.runInNewContext(`${source}\ntoolDebugLogsEnabled()`, {}), false);
  assert.equal(typeof toolDebugLogsEnabled(), 'boolean');
});

test('disabled logs neither output nor serialize the request', () => {
  const noOutput = () => assert.fail('logging should be disabled');
  const body = { toJSON() { assert.fail('request should not be serialized'); } };
  logModelRequest({ entry: 'test', body }, noOutput, false);
  logModelTimeContext({ entry: 'test', messages: [{ get content() { assert.fail('messages should not be inspected'); } }] }, noOutput, false);
});
