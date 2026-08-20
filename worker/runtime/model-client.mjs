import OpenAI from 'openai';
import { collectChatCompletionStream, isTransientModelError, withTransientModelRetry } from '../../lib/agent-runtime/tool-loop.mjs';
import { reserveModelRequest } from './model-budget.mjs';

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
}) {
  async function completeMessage(model, messages, tools, options = {}) {
    if (fakeMode) return { content: '' };
    const totalTimeoutMs = Math.max(1, Number(modelTimeoutMs) || 180_000);
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
    const requestController = new AbortController();
    const timeoutError = new Error(`模型请求超过 ${totalTimeoutMs}ms`);
    timeoutError.code = 'MODEL_TIMEOUT';
    const abortFromCaller = () => requestController.abort(options.signal?.reason);
    if (options.signal?.aborted) abortFromCaller();
    else options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    let rejectTimeout;
    const timeoutPromise = new Promise((_, reject) => { rejectTimeout = reject; });
    const timeout = setTimeout(() => {
      requestController.abort(timeoutError);
      rejectTimeout(timeoutError);
    }, totalTimeoutMs);
    timeout.unref?.();
    try {
      message = await Promise.race([retryTransient(
        async () => {
          if (requestController.signal.aborted) throw requestController.signal.reason || timeoutError;
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
          return collectStream(stream, { onStreamStart: options.onStreamStart });
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
      onRequestComplete?.({
        runId: options.runId || null,
        taskId: options.taskId || null,
        agentId: options.agentId || null,
        attempt: Number(options.attempt) || null,
        scope: options.reserveTaskBudget === false || !options.taskId ? 'run' : 'task',
        iteration: Number(options.iteration) || null,
        durationMs: Date.now() - startedAt,
        requestChars,
        contentChars: message?.diagnostics?.contentChars || 0,
        reasoningContentChars: message?.diagnostics?.reasoningContentChars || 0,
        finishReasons: message?.diagnostics?.finishReasons || [],
        toolCallCount: message?.diagnostics?.completedToolCalls || 0,
        retryCount,
        providerUsage: message?.diagnostics?.usage || null,
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
