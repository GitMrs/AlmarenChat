import { randomUUID } from 'node:crypto';

export const MAX_TOOL_ITERATIONS = 12;
const MAX_TOOL_CALLS = 24;
const MAX_IDENTICAL_TOOL_CALLS = 2;
const MAX_TOOL_RESULT_LENGTH = 16_000;
const TRANSIENT_MODEL_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504, 520, 522, 524]);

export function isTransientModelError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const message = String(error?.message || '');
  const name = String(error?.name || '');
  const causeCode = String(error?.cause?.code || error?.code || '');
  if (name === 'APIUserAbortError' || /(?:user|request).*(?:abort|cancel)/i.test(message)) return false;
  return TRANSIENT_MODEL_STATUSES.has(status)
    || /\b(?:408|409|429|500|502|503|504|520|522|524)\b/.test(message)
    || /(?:timed?\s*out|timeout|terminated|fetch failed|socket hang up|premature close|connection (?:closed|reset)|other side closed)/i.test(message)
    || /^(?:ECONNRESET|ECONNREFUSED|EPIPE|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)$/.test(causeCode);
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

function toolLoopLimit(message, reason) {
  const error = new Error(message);
  error.code = 'TOOL_LOOP_LIMIT';
  error.reason = reason;
  return error;
}

export async function runToolLoop({
  messages,
  requestCompletion,
  tools,
  executeTool,
  isCancelled,
  onModelRequest,
  onLimit = undefined,
  deadlineAt = null,
  maxIterations = MAX_TOOL_ITERATIONS,
  maxToolCalls = MAX_TOOL_CALLS,
}) {
  const conversation = [...messages];
  const signatureCounts = new Map();
  let toolCallCount = 0;
  const assertBudget = () => {
    if (deadlineAt && Date.now() >= deadlineAt) throw toolLoopLimit('Agent 执行超过时间预算，任务已停止', 'deadline');
  };
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    assertBudget();
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
      assertBudget();
      if (isCancelled?.()) throw new Error('任务已取消');
      const name = String(toolCall?.function?.name || '');
      let args = {};
      let result;
      try {
        args = normalizeToolArguments(toolCall?.function?.arguments);
        toolCallCount += 1;
        if (toolCallCount > maxToolCalls) {
          throw toolLoopLimit(`Agent 工具调用超过 ${maxToolCalls} 次，任务已停止`, 'tool_calls');
        }
        const signature = `${name}:${JSON.stringify(args)}`;
        const repeated = (signatureCounts.get(signature) || 0) + 1;
        signatureCounts.set(signature, repeated);
        if (repeated > MAX_IDENTICAL_TOOL_CALLS) {
          throw toolLoopLimit(`Agent 重复执行相同工具且没有进展：${name}`, 'no_progress');
        }
        result = await executeTool(name, args);
      } catch (error) {
        if (error?.code === 'TOOL_LOOP_LIMIT') {
          onLimit?.({ reason: error.reason, message: error.message, iteration, toolCallCount });
          throw error;
        }
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      conversation.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result).slice(0, MAX_TOOL_RESULT_LENGTH),
      });
      if (result?.pause === true) {
        return { content: '', iterations: iteration, paused: true };
      }
    }
  }
  const error = toolLoopLimit(`Agent 工具调用超过 ${maxIterations} 轮，任务已停止`, 'iterations');
  onLimit?.({ reason: error.reason, message: error.message, iteration: maxIterations, toolCallCount });
  throw error;
}
