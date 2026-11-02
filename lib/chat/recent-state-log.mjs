import { modelDebugLogsEnabled } from './model-debug-logging.mjs';

export function logRecentStateLifecycle(event, log = console.info, enabled = modelDebugLogsEnabled()) {
  if (!enabled || !event?.action || !event?.conversationId) return;
  log('[recent-state]', JSON.stringify({
    action: event.action,
    conversationId: event.conversationId,
    sourceMessageId: event.sourceMessageId || null,
    topics: Array.isArray(event.topics) ? event.topics : [],
    status: event.status || null,
    affected: Number(event.affected || 0),
    loggedAtUtc: new Date().toISOString(),
  }));
}
