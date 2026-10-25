import { decryptConnectorCredential } from '../connectors/credentials.mjs';
import { buildCookieHeader } from './auth.mjs';
import { BilibiliError } from './client.mjs';

export function readBilibiliCredentials(connector, secret = process.env.SPACE_CONNECTOR_SECRET) {
  if (!connector?.credentialCiphertext) throw new BilibiliError('B 站账号尚未连接');
  const raw = decryptConnectorCredential(
    connector.credentialCiphertext,
    { spaceId: connector.spaceId, provider: 'BILIBILI' },
    secret
  );
  const sessdata = String(raw.sessdata || '').trim();
  const biliJct = String(raw.biliJct || '').trim();
  if (!sessdata || !biliJct) throw new BilibiliError('B 站凭据不完整，请重新扫码');
  const credentials = {
    sessdata,
    biliJct,
    dedeUserId: String(raw.dedeUserId || '').trim(),
    dedeUserIdCkMd5: String(raw.dedeUserIdCkMd5 || '').trim(),
    buvid3: String(raw.buvid3 || '').trim(),
    buvid4: String(raw.buvid4 || '').trim(),
  };
  return { ...credentials, cookie: buildCookieHeader(credentials) };
}
