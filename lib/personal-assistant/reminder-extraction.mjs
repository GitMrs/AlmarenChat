export function buildReminderExtractionPrompt(userMessage, now = new Date()) {
  const bjNow = new Date(now.getTime() + 8 * 3600 * 1000);
  const bjTimeStr = bjNow.toISOString().replace('Z', '+08:00');
  return `你是一个精准的自然语言时间与多日程待办提取引擎。
当前基准时间（北京时间）：${bjTimeStr}（星期${['日', '一', '二', '三', '四', '五', '六'][bjNow.getUTCDay()]}）

用户的发言：
"""
${String(userMessage || '').slice(0, 500)}
"""

请判断用户是否有让助理“在某个时间提醒某事”、“记录日程安排”或“随手记便签/待办”的意图：
1. 如果用户是在讲过去发生的事或单纯闲聊叙事（如“我昨天下午3点在开会”、“下午3点下了一场大雨”），不是提醒意图，返回 {"hasReminder": false}。
2. 如果存在提醒或便签意图（注意：用户可能一口气安排了多个事项，如“16:30喝水，17:00开会，17:30运动，18:00下班”）：
   - 请将用户提到的每一项具体安排，分别提取为 items 数组中的独立对象：
     - "content": 纯粹的事项主体，去除“提醒我”、“帮我记一下”、“我要”等口吻词，保持凝练明确（如：“喝水”、“开会”、“运动一下”、“下班”）。
     - "dueTime":
       - 若指定了具体时间（无论是相对时间如“半小时后”，还是绝对时刻如“16:30”、“下午5点半”、“明早9点”），请基于基准时间计算出精确的 ISO 8601 字符串（带 +08:00 时区，如 "2026-09-03T16:30:00+08:00"）；
       - 若只是待办或随手记但未指定时间，设为 null。
   - "hasReminder": true

请严格只输出标准 JSON 格式，不要添加 Markdown 代码块标记或任何多余文字：
{"hasReminder": true, "items": [{"content": "喝水", "dueTime": "2026-09-03T16:30:00+08:00"}, {"content": "开会", "dueTime": "2026-09-03T17:00:00+08:00"}]}`;
}

export function parseReminderExtraction(rawText) {
  const cleaned = String(rawText || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  let parsed = {};
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        return [];
      }
    }
  }

  const rawItems = Array.isArray(parsed.items) && parsed.items.length > 0
    ? parsed.items
    : typeof parsed.content === 'string' && parsed.content.trim()
      ? [{ content: parsed.content, dueTime: parsed.dueTime }]
      : [];
  if (!parsed.hasReminder) return [];

  const candidates = [];
  for (const item of rawItems) {
    const content = typeof item?.content === 'string' ? item.content.trim().slice(0, 300) : '';
    if (!content) continue;
    const parsedDate = item.dueTime ? new Date(item.dueTime) : null;
    candidates.push({
      content,
      dueTime: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
    });
  }
  return candidates;
}
