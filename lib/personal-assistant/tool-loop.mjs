const DEFAULT_MAX_ROUNDS = 4;

function messageContent(message) {
  return typeof message?.content === 'string' ? message.content : '';
}

/**
 * Run a bounded assistant tool-calling loop over the shared Tool Broker.
 * @param {{ complete: Function, messages: Array, broker: { call: Function }, tools?: Array, maxRounds?: number }} options
 */
export async function runAssistantToolLoop({ complete, messages, broker, tools, maxRounds = DEFAULT_MAX_ROUNDS } = {}) {
  if (typeof complete !== 'function') throw new TypeError('小伴工具循环缺少模型请求函数');
  if (!broker || typeof broker.call !== 'function') throw new TypeError('小伴工具循环缺少工具代理');
  let currentMessages = [...(messages || [])];
  const rounds = Math.max(1, Math.min(DEFAULT_MAX_ROUNDS, Number(maxRounds) || DEFAULT_MAX_ROUNDS));

  for (let round = 0; round < rounds; round += 1) {
    const response = await complete(currentMessages, tools || []);
    const message = response?.choices?.[0]?.message || response?.message || {};
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (calls.length === 0) return messageContent(message);

    currentMessages = [...currentMessages, {
      role: 'assistant',
      content: message.content || null,
      tool_calls: calls,
    }];
    for (const call of calls.slice(0, 8)) {
      let args = {};
      try { args = JSON.parse(call.function?.arguments || '{}'); } catch { args = {}; }
      let result;
      try {
        result = await broker.call(call.function?.name, args);
      } catch (error) {
        result = { error: String(error instanceof Error ? error.message : error) };
      }
      currentMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 24_000),
      });
    }
  }
  return '';
}
