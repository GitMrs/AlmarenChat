import { modelDebugLogsEnabled } from './model-debug-logging.mjs';

// The caller passes the provider request body, never the client config or headers.
export function logModelRequest({ entry, body }, log = console.info, enabled = modelDebugLogsEnabled()) {
  if (!enabled) return;
  const tools = body?.tools || body?.request?.tools || body?.context?.tools || [];
  log('[model-request]', JSON.stringify({
    entry,
    loggedAtUtc: new Date().toISOString(),
    toolCount: tools.length,
    toolSchemaChars: JSON.stringify(tools).length,
    toolNames: tools.map((tool) => tool.function?.name || tool.name).filter(Boolean),
    request: body,
  }, null, 2));
}
