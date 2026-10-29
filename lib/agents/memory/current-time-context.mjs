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
  return `【当前现实时间】${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}（${parts.weekday}，北京时间 UTC+8，${period}）。这是唯一代表现在的时间。历史消息、记忆、经历摘要和任务记录中的日期只代表对应内容发生或记录的时间，不能覆盖当前现实时间，也不能把旧状态自动延续到现在。请根据当前现实时间和当前用户消息理解“现在、刚才、今天、早上、下午、晚上、今晚、明早”等表达，并使用符合当前时段的问候。`;
}
