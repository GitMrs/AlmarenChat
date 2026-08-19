import OpenAI from 'openai';

export const DEFAULT_BASE_URL = 'https://api-inference.modelscope.cn/v1';
export const DEFAULT_MODEL = 'deepseek-ai/DeepSeek-V4-Flash-0731';

export function createModelClient(baseURL?: string | null, apiKey?: string | null) {
  return new OpenAI({
    baseURL: baseURL || DEFAULT_BASE_URL,
    apiKey: apiKey || process.env.apiKey,
  });
}

export function resolveModelName(modelName?: string | null) {
  return modelName || DEFAULT_MODEL;
}