import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';

function requireSecret(secret = process.env.QQ_ASSISTANT_SECRET) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('QQ_ASSISTANT_SECRET 必须配置为至少 32 位的随机字符串');
  }
  return secret;
}

function encryptionKey(secret) {
  return createHash('sha256').update(`almaren-chat:qq-credentials:${secret}`).digest();
}

export function encryptQQCredential(value, secret) {
  const plainText = typeof value === 'string' ? value.trim() : '';
  if (!plainText) throw new Error('QQ Bot AppSecret 不能为空');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(requireSecret(secret)), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptQQCredential(payload, secret) {
  const [version, ivText, tagText, encryptedText] = String(payload || '').split('.');
  if (version !== VERSION || !ivText || !tagText || !encryptedText) {
    throw new Error('QQ Bot 凭据格式无效');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(requireSecret(secret)),
    Buffer.from(ivText, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function isValidInternalQQSecret(candidate, secret = process.env.QQ_ASSISTANT_SECRET) {
  if (typeof candidate !== 'string' || typeof secret !== 'string' || secret.length < 32) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}
