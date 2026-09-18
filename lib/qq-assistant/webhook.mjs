import { createHash, randomBytes } from 'node:crypto';

export const QQ_WEBHOOK_PATH = '/internal/webhooks/qq';

export function generateQQWebhookToken() {
  return randomBytes(32).toString('base64url');
}

export function hashQQWebhookToken(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

export function buildQQWebhookUrl(token, baseUrl = process.env.QQ_ASSISTANT_WEBHOOK_PUBLIC_URL) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('QQ_ASSISTANT_WEBHOOK_PUBLIC_URL 未配置');
  return `${base}${QQ_WEBHOOK_PATH}/${encodeURIComponent(token)}`;
}
