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

function beijingWeekStart(now, weekOffset) {
  const shifted = new Date(now.getTime() + UTC_8_OFFSET_MS);
  const daysSinceMonday = (shifted.getUTCDay() + 6) % 7;
  return beijingDayStart(now, weekOffset * 7 - daysSinceMonday);
}

function beijingMonthStart(now, monthOffset) {
  const shifted = new Date(now.getTime() + UTC_8_OFFSET_MS);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + monthOffset,
    1
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
  if (message.includes('上周')) {
    return { label: '上周', start: beijingWeekStart(now, -1), end: beijingWeekStart(now, 0) };
  }
  if (message.includes('本周') || message.includes('这周')) {
    return { label: '本周', start: beijingWeekStart(now, 0), end: now };
  }
  if (message.includes('上个月') || message.includes('上月')) {
    return { label: '上个月', start: beijingMonthStart(now, -1), end: beijingMonthStart(now, 0) };
  }
  if (message.includes('本月') || message.includes('这个月')) {
    return { label: '本月', start: beijingMonthStart(now, 0), end: now };
  }
  const recentDays = message.match(/(?:最近|近|过去)\s*([1-9]\d?)\s*天/);
  if (recentDays) {
    const days = Number(recentDays[1]);
    return { label: `最近 ${days} 天`, start: new Date(now.getTime() - days * 24 * 60 * 60 * 1000), end: now };
  }
  if (message.includes('最近')) {
    return { label: '最近 72 小时', start: new Date(now.getTime() - 72 * 60 * 60 * 1000), end: now };
  }
  return null;
}

export function classifyActivityTimestamps({ createdAt, updatedAt, completedAt }, range) {
  const withinRange = (value) => value && value >= range.start && value < range.end;
  const sameTime = (left, right) => left && right && left.getTime() === right.getTime();
  const activities = [];

  if (withinRange(createdAt)) activities.push({ type: 'created', label: '创建', at: createdAt.toISOString() });
  if (withinRange(updatedAt) && !sameTime(updatedAt, createdAt) && !sameTime(updatedAt, completedAt)) {
    activities.push({ type: 'updated', label: '更新', at: updatedAt.toISOString() });
  }
  if (withinRange(completedAt)) activities.push({ type: 'completed', label: '完成', at: completedAt.toISOString() });

  return activities;
}
