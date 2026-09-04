const PERSONAL_FACT_PATTERNS = [
  /(?:请|要|帮我)?记住|别忘了|以后都按/u,
  /我(?:一直|通常|平时|习惯|喜欢|偏好|不喜欢|讨厌|常用|主要用|是个|是一名|从事|住在|来自|生日|养了|有一只)/u,
  /我的(?:名字|生日|职业|工作|习惯|偏好|家人|宠物)/u,
  /\b(?:remember that|i (?:always|usually|prefer|like|dislike|work as|live in|am from))\b/i,
];

export function shouldExtractMemorySuggestion(message) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (text.length < 3) return false;
  return PERSONAL_FACT_PATTERNS.some((pattern) => pattern.test(text));
}
