export function classifyQQCommand(content) {
  const text = String(content || '').trim();
  if (/^(?:\/new|\/新话题|新话题|开启新话题)$/i.test(text)) return { type: 'NEW_CONVERSATION' };

  if (/^(?:完成了|已完成|搞定了|做完了)[！!。.]?$/.test(text)) {
    return { type: 'REMINDER_COMPLETE' };
  }
  if (/^(?:取消提醒|不用提醒了|不再提醒)[！!。.]?$/.test(text)) {
    return { type: 'REMINDER_DISMISS' };
  }
  const snooze = text.match(/^(?:延后|推迟|稍后)(\d{1,3})(分钟|小时)(?:再提醒(?:我)?)?[！!。.]?$/);
  if (snooze) {
    const amount = Number(snooze[1]);
    const minutes = snooze[2] === '小时' ? amount * 60 : amount;
    if (minutes >= 1 && minutes <= 24 * 60) return { type: 'REMINDER_SNOOZE', minutes };
  }
  return { type: 'CHAT' };
}

export function qqReminderRetryDelayMs(attempt) {
  const delays = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
  return delays[Math.min(Math.max(0, Number(attempt) || 0), delays.length - 1)];
}

export function sqliteDate(date = new Date()) {
  return date.toISOString().replace('Z', '+00:00');
}
