export function currentTimeContext(date = new Date()) {
  const timeZone = 'Asia/Shanghai';
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour || 0);
  const period = hour < 5 ? '深夜' : hour < 12 ? '早上' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 23 ? '晚上' : '深夜';
  return `【当前现实时间】${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}（${parts.weekday}，北京时间 UTC+8，${period}）。请根据这个时间理解“早上、下午、晚上、今晚、明早”等表达，并使用符合当前时段的问候。`;
}
