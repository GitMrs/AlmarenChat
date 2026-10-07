import OpenAI from 'openai';
import { smartFetch } from '@/lib/network/proxy';

export const DEFAULT_BASE_URL = 'https://api-inference.modelscope.cn/v1';
export const DEFAULT_MODEL = 'deepseek-ai/DeepSeek-V4-Flash-0731';

export function createModelClient(baseURL?: string | null, apiKey?: string | null) {
  return new OpenAI({
    baseURL: baseURL || DEFAULT_BASE_URL,
    apiKey: apiKey || process.env.apiKey,
    fetch: async (url: any, init: any) => {
      const urlStr = typeof url === 'string' ? url : 'url' in url ? url.url : String(url);
      return smartFetch(urlStr, {
        ...(init || {}),
        prefer: 'direct-first',
        timeoutMs: 30000,
      });
    },
  });
}

export function resolveModelName(modelName?: string | null) {
  return modelName || DEFAULT_MODEL;
}