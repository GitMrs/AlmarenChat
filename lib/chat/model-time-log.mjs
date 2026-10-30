// Extract only explicit date/time values; never log message bodies or credentials.
export function logModelTimeContext({ entry, model, source, messages }, log = console.info) {
  const injectedTimes = [];
  for (const message of messages || []) {
    if (message?.role !== 'system' || typeof message.content !== 'string') continue;
    const pattern = /【当前现实时间】\s*(\d{4}(?:-\d{2}-\d{2}|年\d{1,2}月\d{1,2}日)(?:\s*星期[一二三四五六日天])?\s+\d{2}:\d{2}(?::\d{2})?)/gu;
    for (const match of message.content.matchAll(pattern)) injectedTimes.push(match[1]);
  }
  log('[model-time]', JSON.stringify({
    entry, model, source,
    loggedAtUtc: new Date().toISOString(),
    timeZone: 'Asia/Shanghai',
    injectedTimes,
    missingTimeContext: injectedTimes.length === 0,
  }));
}
