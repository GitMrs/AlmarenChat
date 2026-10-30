import { stripHistoryRetrievalNotices, stripLeadingHistoryTimestampMetadata } from './retrieval-notice.mjs';

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

export function buildAssistantHistory(history) {
  return history
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .map((item, index) => ({
      id: `history-${index}`,
      role: item.role,
      content: item.role === 'assistant'
        ? stripLeadingHistoryTimestampMetadata(stripHistoryRetrievalNotices(item.content))
        : item.content,
      ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    }));
}
