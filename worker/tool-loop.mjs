import { randomUUID } from 'node:crypto';

const MAX_TOOL_ITERATIONS = 12;
const MAX_TOOL_RESULT_LENGTH = 16_000;
const TRANSIENT_MODEL_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504, 520, 522, 524]);

export function isTransientModelError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const message = String(error?.message || '');
  return TRANSIENT_MODEL_STATUSES.has(status)
    || /\b(?:408|409|429|500|502|503|504|520|522|524)\b/.test(message)
    || /(?:timed?\s*out|timeout)/i.test(message);
}

export async function withTransientModelRetry(operation, { onRetry, delayMs = 1_500 } = {}) {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientModelError(error)) throw error;
    onRetry?.(error);
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return operation();
  }
}

export async function collectChatCompletionStream(stream, { onStreamStart, onContentDelta } = {}) {
  let content = '';
  let started = false;
  const toolCalls = new Map();

  const getToolCall = (index) => {
    if (!toolCalls.has(index)) {
      toolCalls.set(index, {
        id: `tool_call_${randomUUID()}`,
        type: 'function',
        function: { name: '', arguments: '' },
      });
    }
    return toolCalls.get(index);
  };

  for await (const chunk of stream) {
    if (!started) {
      started = true;
      onStreamStart?.();
    }
    const delta = chunk?.choices?.[0]?.delta;
    if (!delta) continue;
    if (typeof delta.content === 'string') {
      content += delta.content;
      onContentDelta?.(delta.content);
    }

    for (const fragment of delta.tool_calls || []) {
      const index = Number.isInteger(fragment.index) ? fragment.index : 0;
      const toolCall = getToolCall(index);
      if (fragment.id) {
        toolCall.id = toolCall.id.startsWith('tool_call_') ? fragment.id : `${toolCall.id}${fragment.id}`;
      }
      if (fragment.type) toolCall.type = fragment.type;
      if (fragment.function?.name) toolCall.function.name += fragment.function.name;
      if (fragment.function?.arguments) toolCall.function.arguments += fragment.function.arguments;
    }

    if (delta.function_call) {
      const toolCall = getToolCall(0);
      if (delta.function_call.name) toolCall.function.name += delta.function_call.name;
      if (delta.function_call.arguments) toolCall.function.arguments += delta.function_call.arguments;
    }
  }

  const completedToolCalls = [...toolCalls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, toolCall]) => toolCall);
  return {
    role: 'assistant',
    content: content || null,
    ...(completedToolCalls.length > 0 ? { tool_calls: completedToolCalls } : {}),
  };
}

function normalizeToolArguments(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error('模型返回了无效的工具参数');
  }
}

export async function runToolLoop({ messages, requestCompletion, tools, executeTool, isCancelled, onModelRequest }) {
  const conversation = [...messages];
  for (let iteration = 1; iteration <= MAX_TOOL_ITERATIONS; iteration += 1) {
    if (isCancelled?.()) throw new Error('任务已取消');
    onModelRequest?.({ iteration });
    const message = await requestCompletion(conversation, tools);
    if (isCancelled?.()) throw new Error('任务已取消');
    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    const content = typeof message?.content === 'string' ? message.content.trim() : '';
    conversation.push({
      role: 'assistant',
      content: message?.content || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });

    if (toolCalls.length === 0) {
      if (!content) throw new Error('Agent 没有返回任务结果');
      return { content, iterations: iteration };
    }

    for (const toolCall of toolCalls) {
      if (isCancelled?.()) throw new Error('任务已取消');
      const name = String(toolCall?.function?.name || '');
      let args = {};
      let result;
      try {
        args = normalizeToolArguments(toolCall?.function?.arguments);
        result = await executeTool(name, args);
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      conversation.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result).slice(0, MAX_TOOL_RESULT_LENGTH),
      });
    }
  }
  throw new Error(`Agent 工具调用超过 ${MAX_TOOL_ITERATIONS} 轮，任务已停止`);
}
