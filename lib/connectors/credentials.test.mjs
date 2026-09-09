import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptConnectorCredential, encryptConnectorCredential } from './credentials.mjs';

const secret = 'test-only-secret-that-is-longer-than-32-characters';
const context = { spaceId: 'space-1', provider: 'WECHAT_OFFICIAL_ACCOUNT' };

test('connector credentials round-trip without exposing plaintext', () => {
  const encrypted = encryptConnectorCredential({ appSecret: 'wechat-secret' }, context, secret);
  assert.equal(encrypted.includes('wechat-secret'), false);
  assert.deepEqual(decryptConnectorCredential(encrypted, context, secret), { appSecret: 'wechat-secret' });
});

test('connector credentials are bound to their space and provider', () => {
  const encrypted = encryptConnectorCredential({ appSecret: 'wechat-secret' }, context, secret);
  assert.throws(
    () => decryptConnectorCredential(encrypted, { ...context, spaceId: 'space-2' }, secret),
    /authenticate data|Unsupported state/i
  );
});

test('connector credentials require a dedicated strong secret', () => {
  assert.throws(() => encryptConnectorCredential({ appSecret: 'x' }, context, 'short'), /SPACE_CONNECTOR_SECRET/);
});
