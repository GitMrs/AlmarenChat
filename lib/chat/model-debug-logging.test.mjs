import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { logModelRequest } from './model-request-log.mjs';
import { logModelTimeContext } from './model-time-log.mjs';

const source = (await readFile(new URL('./model-debug-logging.mjs', import.meta.url), 'utf8')).replace('export function', 'function');
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

test('disabled logs neither output nor serialize the request', () => {
  const noOutput = () => assert.fail('logging should be disabled');
  const body = { toJSON() { assert.fail('request should not be serialized'); } };
  logModelRequest({ entry: 'test', body }, noOutput, false);
  logModelTimeContext({ entry: 'test', messages: [{ get content() { assert.fail('messages should not be inspected'); } }] }, noOutput, false);
});
