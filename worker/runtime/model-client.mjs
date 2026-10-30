import OpenAI from 'openai';
import { collectChatCompletionStream, isTransientModelError, withTransientModelRetry } from '../../lib/agents/runtime/tool-loop.mjs';
import { reserveModelRequest } from './model-budget.mjs';

function estimateTokens(text) {
  if (!text) return 0;
  const value = String(text);
  const chineseChars = (value.match(/[\u4e00-\u9fff]/g) || []).length;
  const nonChineseChars = value.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + nonChineseChars / 4);
}

function usageValue(usage, keys) {
  for (const key of keys) {
    const value = Number(usage?.[key]);
    if (value > 0) return value;
  }
  return 0;
}

export function createWorkerModelClient({
  db,
  fakeMode = false,
  modelTimeoutMs,
  now = () => new Date().toISOString(),
  createClient = (options) => new OpenAI(options),
  reserveRequest = reserveModelRequest,
  collectStream = collectChatCompletionStream,
  retryTransient = withTransientModelRetry,
  warn = (...args) => console.warn(...args),
  onRequestComplete = undefined,
  onRequestTimeout = undefined,
  getRun = (runId) => db.prepare('SELECT "retryOfId" FROM "AgentRun" WHERE "id" = ?').get(runId),
}) {
  async function completeMessage(model, messages, tools, options = {}) {
    if (fakeMode) return { content: '' };
    const manualRetry = options.runId ? Boolean(getRun(options.runId)?.retryOfId) : false;
    const totalTimeoutMs = Math.max(1, Number(modelTimeoutMs) || 180_000) * (manualRetry ? 2 : 1);
    const client = createClient({
      apiKey: model.apiKey,
      baseURL: model.baseURL,
      timeout: totalTimeoutMs,
      maxRetries: 0,
    });
    let message;
    let retryCount = 0;
    const startedAt = Date.now();
    const requestChars = JSON.stringify({ messages, tools: tools || [] }).length;
    let firstChunkAt = null;
    let lastChunkAt = null;
    let chunkCount = 0;
    let contentChars = 0;
    let reasoningContentChars = 0;
    let toolArgumentChars = 0;
    let requestAttempt = 0;
    async function* trackStream(stream) {
      for await (const chunk of stream) {
        if (requestController.signal.aborted) return;
        const receivedAt = Date.now();
        firstChunkAt ??= receivedAt;
        lastChunkAt = receivedAt;
        chunkCount += 1;
        const delta = chunk?.choices?.[0]?.delta;
        contentChars += typeof delta?.content === 'string' ? delta.content.length : 0;
        reasoningContentChars += typeof delta?.reasoning_content === 'string' ? delta.reasoning_content.length : 0;
        for (const call of delta?.tool_calls || []) {
          toolArgumentChars += typeof call.function?.arguments === 'string' ? call.function.arguments.length : 0;
        }
        toolArgumentChars += typeof delta?.function_call?.arguments === 'string' ? delta.function_call.arguments.length : 0;
        yield chunk;
      }
    }
    const requestController = new AbortController();
    const timeoutError = new Error(`模型请求超过 ${totalTimeoutMs}ms`);
    timeoutError.code = 'MODEL_TIMEOUT';
    const abortFromCaller = () => requestController.abort(options.signal?.reason);
    if (options.signal?.aborted) abortFromCaller();
    else options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    let rejectTimeout;
    const timeoutPromise = new Promise((_, reject) => { rejectTimeout = reject; });
    const timeout = setTimeout(() => {
      const timedOutAt = Date.now();
      timeoutError.diagnostics = {
        runId: options.runId || null,
        taskId: options.taskId || null,
        agentId: options.agentId || null,
        requestedModel: model.name,
        timeoutMs: totalTimeoutMs,
        manualRetry,
        durationMs: timedOutAt - startedAt,
        requestChars,
        requestAttempt,
        retryCount,
        stage: firstChunkAt === null ? 'WAITING_FIRST_CHUNK' : 'STREAM_STARTED',
        firstChunkAfterMs: firstChunkAt === null ? null : firstChunkAt - startedAt,
        lastChunkAgoMs: lastChunkAt === null ? null : timedOutAt - lastChunkAt,
        chunkCount,
        contentChars,
        reasoningContentChars,
        toolArgumentChars,
      };
      timeoutError.message += firstChunkAt === null
        ? '（当前尝试尚未收到流式响应）'
        : `（已收到响应；正文 ${contentChars} 字符，思考 ${reasoningContentChars} 字符，工具参数 ${toolArgumentChars} 字符；距最后响应 ${timedOutAt - lastChunkAt}ms）`;
      requestController.abort(timeoutError);
      rejectTimeout(timeoutError);
      try {
        warn('[agent-worker] model request timeout', JSON.stringify(timeoutError.diagnostics));
        onRequestTimeout?.(timeoutError.diagnostics);
      } catch (error) {
        warn('[agent-worker] timeout telemetry failed', error instanceof Error ? error.message : String(error));
      }
    }, totalTimeoutMs);
    timeout.unref?.();
    try {
      message = await Promise.race([retryTransient(
        async () => {
          if (requestController.signal.aborted) throw requestController.signal.reason || timeoutError;
          requestAttempt += 1;
          firstChunkAt = lastChunkAt = null;
          chunkCount = contentChars = reasoningContentChars = toolArgumentChars = 0;
          if (options.runId) {
            reserveRequest(db, options.runId, options.reserveTaskBudget === false ? null : options.taskId, now());
          }
          const stream = await client.chat.completions.create(
            {
              model: model.name,
              messages,
              stream: true,
              ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
            },
            { signal: requestController.signal }
          );
          return collectStream(trackStream(stream), {
            onStreamStart: options.onStreamStart,
            onReasoningDelta: options.onReasoningDelta,
            onContentDelta: options.onContentDelta,
          });
        },
        {
          onRetry: (error) => {
            retryCount += 1;
            options.onRetry?.(error);
          },
        }
      ), timeoutPromise]);
    } catch (error) {
      if (error?.code === 'MODEL_TIMEOUT') throw error;
      if (!isTransientModelError(error)) throw error;
      const transientError = new Error(error instanceof Error ? error.message : String(error));
      transientError.code = 'MODEL_PROVIDER_TRANSIENT';
      transientError.status = Number(error?.status || error?.statusCode || 0) || undefined;
      throw transientError;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }
    try {
      const providerUsage = message?.diagnostics?.usage || null;
      const providerInputTokens = usageValue(providerUsage, ['prompt_tokens', 'promptTokens', 'input_tokens', 'inputTokens']);
      const providerOutputTokens = usageValue(providerUsage, ['completion_tokens', 'completionTokens', 'output_tokens', 'outputTokens']);
      const estimatedInputTokens = providerInputTokens || estimateTokens(JSON.stringify({ messages, tools: tools || [] }));
      const estimatedOutputTokens = providerOutputTokens || estimateTokens([
        message?.content || '',
        message?.diagnostics?.reasoningContentChars
          ? 'x'.repeat(message.diagnostics.reasoningContentChars)
          : '',
      ].join(''));
      onRequestComplete?.({
        runId: options.runId || null,
        taskId: options.taskId || null,
        agentId: options.agentId || null,
        attempt: Number(options.attempt) || null,
        scope: options.reserveTaskBudget === false || !options.taskId ? 'run' : 'task',
        iteration: Number(options.iteration) || null,
        durationMs: Date.now() - startedAt,
        requestChars,
        estimatedInputTokens,
        estimatedOutputTokens,
        estimatedTotalTokens: estimatedInputTokens + estimatedOutputTokens,
        contentChars: message?.diagnostics?.contentChars || 0,
        reasoningContentChars: message?.diagnostics?.reasoningContentChars || 0,
        finishReasons: message?.diagnostics?.finishReasons || [],
        toolCallCount: message?.diagnostics?.completedToolCalls || 0,
        retryCount,
        providerUsage,
      });
    } catch (error) {
      warn('[agent-worker] model request telemetry failed', error instanceof Error ? error.message : String(error));
    }
    if (!message?.content && !message?.tool_calls?.length) {
      warn('[agent-worker] empty model response', JSON.stringify({
        runId: options.runId || null,
        taskId: options.taskId || null,
        requestedModel: model.name,
        diagnostics: message?.diagnostics || null,
      }));
    }
    return message;
  }

  async function complete(model, messages, options = {}) {
    const message = await completeMessage(model, messages, [], options);
    return message.content?.trim() || '';
  }

  return { completeMessage, complete };
}
