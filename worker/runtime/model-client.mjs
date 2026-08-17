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
}) {
  async function completeMessage(model, messages, tools, options = {}) {
    if (fakeMode) return { content: '' };
    const client = createClient({
      apiKey: model.apiKey,
      baseURL: model.baseURL,
      timeout: modelTimeoutMs,
      maxRetries: 0,
    });
    let message;
    try {
      message = await retryTransient(
        async () => {
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
            options.signal ? { signal: options.signal } : undefined
          );
          return collectStream(stream, { onStreamStart: options.onStreamStart });
        },
        { onRetry: options.onRetry }
      );
    } catch (error) {
      if (!isTransientModelError(error)) throw error;
      const transientError = new Error(error instanceof Error ? error.message : String(error));
      transientError.code = 'MODEL_PROVIDER_TRANSIENT';
      transientError.status = Number(error?.status || error?.statusCode || 0) || undefined;
      throw transientError;
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
