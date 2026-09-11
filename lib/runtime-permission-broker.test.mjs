import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimePermissionBroker } from './runtime-permission-broker.mjs';

test('runtime broker enforces capability and shared operation budget', () => {
  const broker = createRuntimePermissionBroker({
    authorization: { capabilities: ['web_research'], networkPolicy: 'allowed' },
    operationLimit: 2,
  });
  assert.equal(broker.consume('web_research', 'web_search').allowed, true);
  assert.equal(broker.consume('web_research', 'web_fetch').allowed, true);
  assert.equal(broker.consume('web_research', 'web_search').code, 'OPERATION_LIMIT');
  assert.deepEqual(broker.usage, { used: 2, limit: 2, remaining: 0 });
});

test('runtime broker rejects disabled or ungranted capabilities', () => {
  assert.equal(createRuntimePermissionBroker({
    authorization: { capabilities: ['web_research'], networkPolicy: 'forbidden' },
  }).consume('web_research').code, 'NETWORK_DISABLED');
  assert.equal(createRuntimePermissionBroker({
    authorization: { capabilities: [], networkPolicy: 'allowed' },
  }).consume('web_research').code, 'CAPABILITY_DENIED');
});
