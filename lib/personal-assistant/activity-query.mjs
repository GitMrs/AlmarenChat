const UTC_8_OFFSET_MS = 8 * 60 * 60 * 1000;
const ACTIVITY_INTENT_PATTERN = /(?:干(?:了|过|啥)|做(?:了|过|什么|啥)|忙(?:了|什么|啥)|完成(?:了|什么)|活动|记录|进展|回顾)/;

function beijingDayStart(now, dayOffset) {
  const shifted = new Date(now.getTime() + UTC_8_OFFSET_MS);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + dayOffset
  ) - UTC_8_OFFSET_MS);
}

export function resolveActivityRange(message, now = new Date()) {
  if (!ACTIVITY_INTENT_PATTERN.test(message)) return null;

  if (message.includes('前天')) {
    return { label: '前天', start: beijingDayStart(now, -2), end: beijingDayStart(now, -1) };
  }
  if (message.includes('昨天')) {
    return { label: '昨天', start: beijingDayStart(now, -1), end: beijingDayStart(now, 0) };
  }
  if (message.includes('今天')) {
    return { label: '今天', start: beijingDayStart(now, 0), end: beijingDayStart(now, 1) };
  }
  if (message.includes('最近')) {
    return { label: '最近 72 小时', start: new Date(now.getTime() - 72 * 60 * 60 * 1000), end: now };
  }
  return null;
}
