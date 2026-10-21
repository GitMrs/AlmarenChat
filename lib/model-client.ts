import OpenAI from 'openai';
import { smartFetch, type SmartFetchOptions } from '@/lib/network/proxy';

export const DEFAULT_BASE_URL = 'https://api-inference.modelscope.cn/v1';
export const DEFAULT_MODEL = 'deepseek-ai/DeepSeek-V4.1-Flash-1017';
const MODEL_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MODEL_CLIENT_OPTIONS = {
  maxRetries: 1,
  prefer: 'direct-only' as const,
  timeoutMs: MODEL_REQUEST_TIMEOUT_MS,
};

type ModelClientOptions = {
  maxRetries?: number;
  prefer?: SmartFetchOptions['prefer'];
  timeoutMs?: number;
};

export function createModelClient(
  baseURL?: string | null,
  apiKey?: string | null,
  options: ModelClientOptions = {}
) {
  const clientOptions = { ...DEFAULT_MODEL_CLIENT_OPTIONS, ...options };
  return new OpenAI({
    baseURL: baseURL || DEFAULT_BASE_URL,
    apiKey: apiKey || process.env.apiKey || process.env.OPENAI_API_KEY,
    maxRetries: clientOptions.maxRetries,
    fetch: async (url: any, init: any) => {
      const urlStr = typeof url === 'string' ? url : 'url' in url ? url.url : String(url);
      return smartFetch(urlStr, {
        ...(init || {}),
        prefer: clientOptions.prefer,
        timeoutMs: clientOptions.timeoutMs,
      });
    },
  });
}

export function resolveModelName(modelName?: string | null) {
  return modelName || DEFAULT_MODEL;
}
