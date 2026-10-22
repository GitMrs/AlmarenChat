import { randomUUID } from 'node:crypto';

export const MAX_TOOL_ITERATIONS = 12;
const MAX_TOOL_CALLS = 24;
const MAX_IDENTICAL_TOOL_CALLS = 2;
const MAX_TOOL_RESULT_LENGTH = 160_000;
const MAX_RETAINED_MUTATION_ARGUMENT_CHARS = 12_000;
const TRANSIENT_MODEL_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504, 520, 522, 524]);
const COMPACTABLE_MUTATION_TOOLS = new Set(['write_file', 'patch_file', 'patch_files']);
const PATCH_TOOLS = new Set(['patch_file', 'patch_files']);

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
  const deltaFields = new Set();
  const finishReasons = new Set();
  const responseModels = new Set();
  let chunkCount = 0;
  let choiceCount = 0;
  let reasoningContentChars = 0;
  let refusalChars = 0;
  let toolCallFragments = 0;
  let usage = null;

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
    chunkCount += 1;
    if (chunk?.usage && typeof chunk.usage === 'object') {
      usage = Object.fromEntries(
        Object.entries(chunk.usage)
          .filter(([, value]) => Number.isFinite(value))
          .slice(0, 20)
      );
    }
    if (chunk?.model) responseModels.add(String(chunk.model).slice(0, 200));
    if (!started) {
      started = true;
      onStreamStart?.();
    }
    const choices = Array.isArray(chunk?.choices) ? chunk.choices : [];
    choiceCount += choices.length;
    const choice = choices[0];
    if (choice?.finish_reason) finishReasons.add(String(choice.finish_reason).slice(0, 100));
    const delta = choice?.delta;
    if (!delta) continue;
    for (const field of Object.keys(delta)) deltaFields.add(field.slice(0, 100));
    if (typeof delta.content === 'string') {
      content += delta.content;
      onContentDelta?.(delta.content);
    }
    if (typeof delta.reasoning_content === 'string') reasoningContentChars += delta.reasoning_content.length;
    if (typeof delta.refusal === 'string') refusalChars += delta.refusal.length;

    for (const fragment of delta.tool_calls || []) {
      toolCallFragments += 1;
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
    diagnostics: {
      chunkCount,
      choiceCount,
      deltaFields: [...deltaFields].slice(0, 20),
      finishReasons: [...finishReasons].slice(0, 10),
      responseModels: [...responseModels].slice(0, 5),
      contentChars: content.length,
      reasoningContentChars,
      refusalChars,
      toolCallFragments,
      completedToolCalls: completedToolCalls.length,
      usage,
    },
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

function compactSuccessfulMutationArguments(toolCall, name, args, result) {
  if (!COMPACTABLE_MUTATION_TOOLS.has(name) || result?.ok === false || result?.error) return;
  const argumentChars = name === 'write_file'
    ? String(args.content ?? '').length
    : name === 'patch_file'
      ? String(args.search ?? '').length + String(args.replacement ?? '').length
      : (Array.isArray(args.edits) ? args.edits : []).reduce(
          (total, edit) => total + String(edit?.search ?? '').length + String(edit?.replacement ?? '').length,
          0
        );
  if (argumentChars <= MAX_RETAINED_MUTATION_ARGUMENT_CHARS) return;
  const omitted = (value) => `[已成功执行，${String(value ?? '').length} 个字符已省略；如需内容请读取文件]`;
  let compacted;
  if (name === 'write_file') {
    compacted = { path: args.path, content: omitted(args.content) };
  } else if (name === 'patch_file') {
    compacted = {
      path: args.path,
      search: omitted(args.search),
      replacement: omitted(args.replacement),
      ...(args.replaceAll ? { replaceAll: true } : {}),
    };
  } else {
    compacted = {
      edits: (Array.isArray(args.edits) ? args.edits : []).map((edit) => ({
        path: edit?.path,
        search: omitted(edit?.search),
        replacement: omitted(edit?.replacement),
        ...(edit?.replaceAll ? { replaceAll: true } : {}),
      })),
    };
  }
  toolCall.function.arguments = JSON.stringify(compacted);
}

function toolLoopLimit(message, reason) {
  const error = new Error(message);
  error.code = 'TOOL_LOOP_LIMIT';
  error.reason = reason;
  return error;
}

function mutationPaths(name, args, result) {
  if (result?.ok === false || result?.error) return [];
  if (name === 'write_file' || name === 'patch_file') return args.path ? [String(args.path)] : [];
  if (name === 'patch_files') {
    return (Array.isArray(args.edits) ? args.edits : [])
      .map((edit) => String(edit?.path || ''))
      .filter(Boolean);
  }
  return [];
}

function recordToolProgress(readProgress, name, args, result) {
  for (const mutatedPath of mutationPaths(name, args, result)) readProgress.delete(mutatedPath);
  if (name !== 'read_file' || result?.ok === false || result?.error) return;

  const filePath = String(result?.path || args.path || '');
  const offset = Number(result?.offset);
  const nextOffset = Number(result?.nextOffset);
  const totalChars = Number(result?.totalChars);
  if (!filePath || !Number.isFinite(offset) || !Number.isFinite(nextOffset) || !Number.isFinite(totalChars)) return;

  const previous = readProgress.get(filePath);
  const ranges = previous?.totalChars === totalChars ? [...previous.ranges] : [];
  ranges.push([Math.max(0, offset), Math.min(totalChars, nextOffset)]);
  ranges.sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const range of ranges) {
    const tail = merged.at(-1);
    if (tail && range[0] <= tail[1]) tail[1] = Math.max(tail[1], range[1]);
    else merged.push([...range]);
  }
  readProgress.set(filePath, {
    totalChars,
    ranges: merged,
    complete: merged.length === 1 && merged[0][0] === 0 && merged[0][1] >= totalChars,
  });
}

function restoreToolProgress(conversation) {
  const readProgress = new Map();
  const pendingCalls = new Map();
  for (const message of conversation) {
    for (const toolCall of message?.tool_calls || []) {
      try {
        pendingCalls.set(toolCall.id, {
          name: String(toolCall?.function?.name || ''),
          args: normalizeToolArguments(toolCall?.function?.arguments),
        });
      } catch {
        // Invalid historical calls cannot provide reliable progress information.
      }
    }
    if (message?.role !== 'tool') continue;
    const call = pendingCalls.get(message.tool_call_id);
    if (!call) continue;
    try {
      recordToolProgress(readProgress, call.name, call.args, JSON.parse(message.content || '{}'));
    } catch {
      // Truncated historical results are ignored and can be read again safely.
    }
  }
  return readProgress;
}

export async function runToolLoop({
  messages,
  requestCompletion,
  tools,
  executeTool,
  isCancelled,
  onModelRequest,
  onEmptyResponse = undefined,
  onLimit = undefined,
  onIterationLimit = undefined,
  onCheckpoint = undefined,
  deadlineAt = null,
  maxIterations = MAX_TOOL_ITERATIONS,
  maxToolCalls = MAX_TOOL_CALLS,
  maxEmptyResponseRetries = 1,
  requiredFinalTool = null,
  iterationOffset = 0,
  batchIterationOffset = 0,
  batchLimit = maxIterations + batchIterationOffset,
  initialToolCallCount = 0,
}) {
  const conversation = [...messages];
  const signatureCounts = new Map();
  const readProgress = restoreToolProgress(conversation);
  let toolCallCount = Math.max(0, Number(initialToolCallCount) || 0);
  let emptyResponseCount = 0;
  let previousEmptyDiagnostics = null;
  const assertBudget = () => {
    if (deadlineAt && Date.now() >= deadlineAt) throw toolLoopLimit('Agent 执行超过时间预算，任务已停止', 'deadline');
  };
  let iteration = 1;
  let finalizationWarningAdded = false;
  let finalizationWarning = null;
  const saveCheckpoint = async () => {
    if (!onCheckpoint) return;
    await onCheckpoint({
      version: 1,
      conversation: conversation.filter((item) => item !== finalizationWarning),
      completedIterations: iteration,
      totalIterations: iterationOffset + iteration,
      batchCompletedIterations: batchIterationOffset + iteration,
      batchLimit,
      toolCallCount,
    });
  };
  while (iteration <= maxIterations) {
    assertBudget();
    if (isCancelled?.()) throw new Error('任务已取消');
    if (requiredFinalTool && iteration === maxIterations && !finalizationWarningAdded) {
      finalizationWarning = {
        role: 'system',
        content: `这是最后一个有效执行轮次。停止继续读取、复查或润色；已经完成时必须立即调用 ${requiredFinalTool} 提交，不能再调用其他工具。`,
      };
      conversation.push(finalizationWarning);
      finalizationWarningAdded = true;
    }
    onModelRequest?.({
      iteration,
      batchIteration: batchIterationOffset + iteration,
      totalIteration: iterationOffset + iteration,
    });
    const message = await requestCompletion(conversation, tools, {
      iteration,
      batchIteration: batchIterationOffset + iteration,
      totalIteration: iterationOffset + iteration,
      emptyResponseCount,
      previousEmptyDiagnostics,
    });
    if (isCancelled?.()) throw new Error('任务已取消');
    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    const content = typeof message?.content === 'string' ? message.content.trim() : '';
    if (toolCalls.length === 0 && !content) {
      emptyResponseCount += 1;
      if (emptyResponseCount > maxEmptyResponseRetries) {
        const error = new Error('Agent 没有返回任务结果');
        error.code = 'EMPTY_MODEL_RESPONSE';
        error.diagnostics = message?.diagnostics || previousEmptyDiagnostics;
        throw error;
      }
      onEmptyResponse?.({
        iteration,
        retry: emptyResponseCount,
        maxRetries: maxEmptyResponseRetries,
        diagnostics: message?.diagnostics || null,
      });
      previousEmptyDiagnostics = message?.diagnostics || null;
      const reasoningBudgetExhausted = previousEmptyDiagnostics?.reasoningContentChars > 0
        && previousEmptyDiagnostics?.finishReasons?.includes('length');
      conversation.push({
        role: 'system',
        content: reasoningBudgetExhausted
          ? '上一次响应的输出预算全部耗尽在内部推理，没有产生可执行动作。立即停止扩展分析：需要操作工作区时，下一个输出必须直接调用合适工具；已完成时直接返回简短最终结果。不得再次只输出推理内容。'
          : '上一次响应为空。请继续当前任务：需要操作工作区时立即调用合适工具；任务已完成时直接返回简短、可核对的最终结果。不得再次返回空内容。',
      });
      // Empty provider responses have their own retry budget and do not consume
      // the task's productive tool-iteration budget.
      continue;
    }
    conversation.push({
      role: 'assistant',
      content: message?.content || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });

    if (toolCalls.length === 0) {
      if (!requiredFinalTool) return { content, iterations: iteration };
      conversation.push({
        role: 'system',
        content: `当前任务不能通过普通文本结束。完成后必须调用 ${requiredFinalTool}；如果尚未完成，请继续使用可用工具处理。`,
      });
      await saveCheckpoint();
      iteration += 1;
      continue;
    }

    const orderedToolCalls = requiredFinalTool
      ? [...toolCalls.filter((toolCall) => toolCall?.function?.name !== requiredFinalTool),
          ...toolCalls.filter((toolCall) => toolCall?.function?.name === requiredFinalTool)]
      : toolCalls;
    for (let toolIndex = 0; toolIndex < orderedToolCalls.length; toolIndex += 1) {
      const toolCall = orderedToolCalls[toolIndex];
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
        if (name !== requiredFinalTool) {
          const readPath = name === 'read_file' ? String(args.path || '') : '';
          const alreadyFullyRead = Boolean(readPath && readProgress.get(readPath)?.complete);
          const signature = alreadyFullyRead
            ? `read_file:already-complete:${readPath}`
            : `${name}:${JSON.stringify(args)}`;
          const repeated = (signatureCounts.get(signature) || 0) + 1;
          signatureCounts.set(signature, repeated);
          if (repeated > MAX_IDENTICAL_TOOL_CALLS) {
            throw toolLoopLimit(`Agent 重复执行相同工具且没有进展：${name}`, 'no_progress');
          }
          if (alreadyFullyRead) {
            result = {
              ok: false,
              error: `文件 ${readPath} 已完整读取并保留在当前上下文中，请直接修改或提交，不要再次读取。`,
            };
          }
        }
        if (!result) result = await executeTool(name, args);
        recordToolProgress(readProgress, name, args, result);
        for (const mutatedPath of mutationPaths(name, args, result)) {
          signatureCounts.delete(`read_file:already-complete:${mutatedPath}`);
        }
        compactSuccessfulMutationArguments(toolCall, name, args, result);
      } catch (error) {
        if (error?.code === 'TOOL_LOOP_LIMIT') {
          onLimit?.({ reason: error.reason, message: error.message, iteration, toolCallCount });
          throw error;
        }
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      if (PATCH_TOOLS.has(name) && (result?.ok === false || result?.error)) {
        result = {
          ...result,
          guidance: '补丁未应用。目标文件可能已经变化；下一步先用 read_file 读取待修改位置的最新内容，再使用较短且唯一的 search 生成新补丁。不要原样重试本次参数。',
        };
      }
      conversation.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result).slice(0, MAX_TOOL_RESULT_LENGTH),
      });
      if (result?.pause === true) {
        for (const skippedToolCall of orderedToolCalls.slice(toolIndex + 1)) {
          conversation.push({
            role: 'tool',
            tool_call_id: skippedToolCall.id,
            content: JSON.stringify({ ok: false, skipped: true, error: '任务已暂停，此工具尚未执行' }),
          });
        }
        await saveCheckpoint();
        return { content: '', iterations: iteration, paused: true };
      }
      if (result?.stop === true) {
        return { content: String(result.content || '').trim(), iterations: iteration };
      }
    }
    await saveCheckpoint();
    iteration += 1;
  }
  const error = toolLoopLimit(`Agent 工具调用超过 ${maxIterations} 轮，任务已停止`, 'iterations');
  onLimit?.({ reason: error.reason, message: error.message, iteration: maxIterations, toolCallCount });
  if (await onIterationLimit?.({
    reason: error.reason,
    message: error.message,
    iteration: maxIterations,
    totalIteration: iterationOffset + maxIterations,
    toolCallCount,
  })) {
    return { content: '', iterations: maxIterations, paused: true, pauseReason: 'iterations' };
  }
  throw error;
}
