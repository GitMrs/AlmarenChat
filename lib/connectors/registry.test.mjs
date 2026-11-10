import assert from 'node:assert/strict';
import test from 'node:test';
import { canRetryConnectorStatus, connectorActionDefinition, connectorDefinition, serializeConnector } from './registry.mjs';

test('wechat publishing actions always require high-risk approval', () => {
  assert.equal(connectorDefinition('wechat_official_account').name, '微信公众号');
  assert.deepEqual(connectorActionDefinition('WECHAT_OFFICIAL_ACCOUNT', 'WECHAT_VALIDATE_CONNECTION'), {
    riskLevel: 'LOW',
    approvalRequired: false,
  });
  assert.deepEqual(connectorActionDefinition('WECHAT_OFFICIAL_ACCOUNT', 'WECHAT_PUBLISH'), {
    riskLevel: 'HIGH',
    approvalRequired: true,
  });
});

test('only a failed publish with a durable publish id can resume status checks', () => {
  assert.equal(canRetryConnectorStatus({ kind: 'WECHAT_PUBLISH', status: 'FAILED', connectorExecution: { externalId: 'publish-1' } }), true);
  assert.equal(canRetryConnectorStatus({ kind: 'WECHAT_PUBLISH', status: 'FAILED', connectorExecution: { externalId: null } }), false);
  assert.equal(canRetryConnectorStatus({ kind: 'WECHAT_CREATE_DRAFT', status: 'FAILED', connectorExecution: { externalId: 'draft-1' } }), false);
});

test('connector serialization never returns ciphertext or unknown config', () => {
  const result = serializeConnector({
    id: 'connector-1',
    spaceId: 'space-1',
    provider: 'WECHAT_OFFICIAL_ACCOUNT',
    enabled: true,
    status: 'CONFIGURED',
    publicConfig: { appId: 'wx-app', appSecret: 'must-not-leak', extra: 'hidden' },
    credentialCiphertext: 'ciphertext',
    lastError: null,
    createdAt: new Date('2026-09-08T00:00:00Z'),
    updatedAt: new Date('2026-09-08T01:00:00Z'),
  });
  assert.deepEqual(result.publicConfig, { appId: 'wx-app' });
  assert.equal(result.configured, true);
  assert.equal('credentialCiphertext' in result, false);
});

test('WeChat serialization exposes only bounded permission evidence fields', () => {
  const result = serializeConnector({
    id: 'connector-1', provider: 'WECHAT_OFFICIAL_ACCOUNT', enabled: true,
    publicConfig: { appId: 'wx-app', interfacePermissions: {
      draft: { status: 'available', checkedAt: '2026-11-09T00:00:00Z', appSecret: 'hidden' },
      publish: { status: 'guessed', checkedAt: '2026-11-09T00:00:00Z' },
      arbitrary: 'hidden',
    } },
  });
  assert.deepEqual(result.publicConfig.interfacePermissions, { draft: { status: 'available', checkedAt: '2026-11-09T00:00:00Z' } });
  const other = serializeConnector({ provider: 'BILIBILI', publicConfig: { interfacePermissions: { draft: { status: 'available', checkedAt: 'now' } } } });
  assert.equal(other.publicConfig.interfacePermissions, undefined);
});
