import OpenAI from 'openai';

export const DEFAULT_AI_BASE_URL = 'https://api-inference.modelscope.cn/v1';
export const DEFAULT_AI_MODEL = 'deepseek-ai/DeepSeek-V4-Flash';

type AISettings = {
  apiBaseUrl?: string | null;
  apiKey?: string | null;
  modelName?: string | null;
};

export function createOpenAIClient(settings?: AISettings | null) {
  return {
    client: new OpenAI({
      baseURL: settings?.apiBaseUrl || DEFAULT_AI_BASE_URL,
      apiKey: settings?.apiKey || process.env.apiKey,
    }),
    model: settings?.modelName || DEFAULT_AI_MODEL,
  };
}
