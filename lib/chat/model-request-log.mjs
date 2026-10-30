import { modelDebugLogsEnabled } from './model-debug-logging.mjs';

// The caller passes the provider request body, never the client config or headers.
export function logModelRequest({ entry, body }, log = console.info, enabled = modelDebugLogsEnabled()) {
  if (!enabled) return;
  log('[model-request]', JSON.stringify({
    entry,
    loggedAtUtc: new Date().toISOString(),
    request: body,
  }, null, 2));
}
