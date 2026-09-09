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

export function qqWebSearchEnabled(ext) {
  if (!Array.isArray(ext)) return false;
  return ext.some((entry) => {
    if (typeof entry !== 'string') return false;
    const separator = entry.indexOf('=');
    if (separator < 0) return false;
    return entry.slice(0, separator).trim() === 'web_search'
      && entry.slice(separator + 1).trim() === '1';
  });
}

export function qqImageAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments.flatMap((attachment) => {
    const mimeType = String(attachment?.content_type || attachment?.mimeType || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const url = String(attachment?.url || '').trim();
    if (!mimeType.startsWith('image/') || !url || url.length > 10_000) return [];
    try {
      if (new URL(url).protocol !== 'https:') return [];
    } catch {
      return [];
    }
    const name = String(attachment?.filename || attachment?.name || '').trim().slice(0, 255);
    const size = Number(attachment?.size);
    return [{
      type: 'image',
      url,
      mimeType,
      ...(name ? { name } : {}),
      ...(Number.isFinite(size) && size > 0 ? { size } : {}),
    }];
  }).slice(0, 4);
}

export function sqliteDate(date = new Date()) {
  return date.toISOString().replace('Z', '+00:00');
}
