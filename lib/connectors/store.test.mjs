import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptConnectorCredential } from './credentials.mjs';
import { createEncryptedConnectorTokenCache, readWechatConnectorCredentials } from './store.mjs';

const secret = 'test-only-secret-that-is-longer-than-32-characters';

function connector() {
  return {
    id: 'connector-1',
    spaceId: 'space-1',
    provider: 'WECHAT_OFFICIAL_ACCOUNT',
    publicConfig: { appId: 'wx-app' },
    credentialCiphertext: encryptConnectorCredential(
      { appSecret: 'app-secret' },
      { spaceId: 'space-1', provider: 'WECHAT_OFFICIAL_ACCOUNT' },
      secret
    ),
    accessTokenCiphertext: null,
    accessTokenExpiresAt: null,
  };
}

test('wechat connector credentials are decrypted only inside the connector boundary', () => {
  assert.deepEqual(readWechatConnectorCredentials(connector(), secret), { appId: 'wx-app', appSecret: 'app-secret' });
});

test('connector access token cache persists encrypted tokens', async () => {
  const record = connector();
  let persisted = null;
  const cache = createEncryptedConnectorTokenCache({
    connector: record,
    secret,
    now: () => 1_000,
    update: async (id, data) => { persisted = { id, ...data }; },
  });
  await cache.set({ token: 'access-token', expiresAt: 10_000 });
  assert.equal(persisted.id, record.id);
  assert.equal(persisted.accessTokenCiphertext.includes('access-token'), false);
  assert.deepEqual(await cache.get(), { token: 'access-token', expiresAt: 10_000 });
  await cache.clear();
  assert.equal(await cache.get(), null);
});
