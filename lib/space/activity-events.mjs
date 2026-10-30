// Keep each model request and tool call in one stable row while polling updates.
export function compactActivityEvents(events) {
  const rows = [];
  const positions = new Map();
  const activeTools = new Map();
  for (const event of events) {
    const payload = event.payload || {};
    if (event.type === 'TOOL_STARTED' && payload.toolCallId) activeTools.set(payload.tool, payload.toolCallId);
    if (event.type === 'TOOL_COMPLETED' && !payload.toolCallId && activeTools.has(payload.tool)) continue;
    if (event.type === 'TOOL_FINISHED' && activeTools.get(payload.tool) === payload.toolCallId) activeTools.delete(payload.tool);
    const key = event.type === 'MODEL_REASONING_PROGRESS' && payload.requestId
      ? `model:${payload.requestId}`
      : payload.toolCallId ? `tool:${payload.toolCallId}` : null;
    if (key && positions.has(key)) rows[positions.get(key)] = event;
    else {
      if (key) positions.set(key, rows.length);
      rows.push(event);
    }
  }
  return rows;
}
