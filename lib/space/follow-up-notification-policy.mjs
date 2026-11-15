export const FOLLOW_UP_QQ_PREFIX = 'crypto-follow-up:';
export const FOLLOW_UP_QQ_MAX_AGE_MS = 30 * 60_000;
export const FOLLOW_UP_QQ_COOLDOWN_MS = 5 * 60_000;
export const MARKET_QQ_MAX_DELIVERY_ATTEMPTS = 3;
export const FOLLOW_UP_QQ_CATEGORIES = ['KEY_LEVEL_CHANGE', 'THESIS_INVALIDATED', 'USER_DECISION_REQUIRED', 'IMPORTANT_CHANGE', 'GOAL_COMPLETED'];

export function isMarketQQNotification(reminder) {
  return reminder.idempotencyKey?.startsWith(FOLLOW_UP_QQ_PREFIX) || reminder.idempotencyKey?.startsWith('crypto-sentinel:') || false;
}

export function normalizeFollowUpNotification(input) {
  if (!FOLLOW_UP_QQ_CATEGORIES.includes(input?.category)) throw new Error('仅重要变化、目标完成、判断失效或需要用户决定的事项可通知');
  const result = { category: input.category };
  for (const [key, max] of [['eventKey', 160], ['title', 100], ['summary', 1000], ['reason', 300]]) {
    const value = String(input?.[key] || '').trim();
    if (!value || value.length > max) throw new Error(`${key} 不能为空，且不能超过${max}字`);
    result[key] = value;
  }
  result.eventKey = result.eventKey.toUpperCase().replace(/\s+/g, '');
  return result;
}

export function followUpSpaceLink(spaceId, appUrl = process.env.APP_URL) {
  const path = `/spaces/${encodeURIComponent(spaceId)}`;
  try {
    const base = new URL(appUrl);
    if (['http:', 'https:'].includes(base.protocol) && !base.username && !base.password) return new URL(path, base).toString();
  } catch {}
  return '';
}
