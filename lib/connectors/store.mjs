import { decryptConnectorCredential, encryptConnectorCredential } from './credentials.mjs';

function credentialContext(connector) {
  return { spaceId: connector?.spaceId, provider: connector?.provider };
}

function tokenContext(connector) {
  return { spaceId: connector?.spaceId, provider: `${connector?.provider || ''}_ACCESS_TOKEN` };
}

export function readWechatConnectorCredentials(connector, secret) {
  if (connector?.provider !== 'WECHAT_OFFICIAL_ACCOUNT') throw new Error('连接器不是微信公众号类型');
  const appId = typeof connector.publicConfig?.appId === 'string' ? connector.publicConfig.appId.trim() : '';
  const credentials = decryptConnectorCredential(connector.credentialCiphertext, credentialContext(connector), secret);
  const appSecret = typeof credentials.appSecret === 'string' ? credentials.appSecret.trim() : '';
  if (!appId || !appSecret) throw new Error('微信公众号连接器凭据不完整');
  return { appId, appSecret };
}

export function createEncryptedConnectorTokenCache({ connector, update, secret, now = () => Date.now() }) {
  if (!connector?.id || typeof update !== 'function') throw new Error('连接器令牌缓存配置无效');
  return {
    async get() {
      const expiresAt = connector.accessTokenExpiresAt ? new Date(connector.accessTokenExpiresAt).getTime() : 0;
      if (!connector.accessTokenCiphertext || !Number.isFinite(expiresAt) || expiresAt <= now()) return null;
      try {
        const value = decryptConnectorCredential(connector.accessTokenCiphertext, tokenContext(connector), secret);
        return typeof value.accessToken === 'string' && value.accessToken ? { token: value.accessToken, expiresAt } : null;
      } catch {
        return null;
      }
    },
    async set({ token, expiresAt }) {
      const accessToken = typeof token === 'string' ? token.trim() : '';
      if (!accessToken || !Number.isFinite(Number(expiresAt))) throw new Error('连接器令牌缓存内容无效');
      const data = {
        accessTokenCiphertext: encryptConnectorCredential({ accessToken }, tokenContext(connector), secret),
        accessTokenExpiresAt: new Date(Number(expiresAt)),
      };
      await update(connector.id, data);
      Object.assign(connector, data);
    },
    async clear() {
      const data = { accessTokenCiphertext: null, accessTokenExpiresAt: null };
      await update(connector.id, data);
      Object.assign(connector, data);
    },
  };
}
