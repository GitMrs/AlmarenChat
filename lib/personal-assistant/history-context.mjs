const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, '0');
}

export function formatAssistantHistoryTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const beijing = new Date(date.getTime() + BEIJING_OFFSET_MS);
  return [
    beijing.getUTCFullYear(),
    pad(beijing.getUTCMonth() + 1),
    pad(beijing.getUTCDate()),
  ].join('-') + ` ${pad(beijing.getUTCHours())}:${pad(beijing.getUTCMinutes())}`;
}

export function buildTimedAssistantHistory(history) {
  return history
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .map((item, index) => {
      const timestamp = formatAssistantHistoryTimestamp(item.createdAt);
      return {
        id: `history-${index}`,
        role: item.role,
        content: timestamp
          ? `[历史消息时间：${timestamp}，北京时间]\n${item.content}`
          : item.content,
      };
    });
}
