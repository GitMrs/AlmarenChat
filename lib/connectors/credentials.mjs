import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'v1';

function requireSecret(secret = process.env.SPACE_CONNECTOR_SECRET) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('SPACE_CONNECTOR_SECRET 必须配置为至少 32 位的随机字符串');
  }
  return secret;
}

function encryptionKey(secret) {
  return createHash('sha256').update(`almaren-chat:space-connectors:${secret}`).digest();
}

function associatedData(context) {
  const spaceId = typeof context?.spaceId === 'string' ? context.spaceId.trim() : '';
  const provider = typeof context?.provider === 'string' ? context.provider.trim().toUpperCase() : '';
  if (!spaceId || !provider) throw new Error('连接器凭据缺少加密上下文');
  return Buffer.from(`${spaceId}:${provider}`, 'utf8');
}

export function encryptConnectorCredential(value, context, secret) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('连接器凭据格式无效');
  const plainText = JSON.stringify(value);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(requireSecret(secret)), iv);
  cipher.setAAD(associatedData(context));
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptConnectorCredential(payload, context, secret) {
  const [version, ivText, tagText, encryptedText] = String(payload || '').split('.');
  if (version !== VERSION || !ivText || !tagText || !encryptedText) throw new Error('连接器凭据格式无效');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(requireSecret(secret)),
    Buffer.from(ivText, 'base64url')
  );
  decipher.setAAD(associatedData(context));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  const plainText = Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  const parsed = JSON.parse(plainText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('连接器凭据内容无效');
  return parsed;
}
