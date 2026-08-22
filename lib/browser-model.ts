export type BrowserModelSource = 'ONLINE' | 'OLLAMA';
export type BrowserModelScope = 'GLOBAL' | 'CONVERSATION';

export type BrowserModelConfig = {
  source: BrowserModelSource;
  baseUrl: string;
  model: string;
  apiKey: string;
};

type ModelMessage = {
  role: 'system' | 'user' | 'assistant';
  content: unknown;
};

const GLOBAL_CONFIG_KEY = 'almaren:browser-model:global:v1';
const CONVERSATION_CONFIG_PREFIX = 'almaren:browser-model:conversation:v1:';

export const DEFAULT_BROWSER_MODEL_CONFIG: BrowserModelConfig = {
  source: 'ONLINE',
  baseUrl: 'http://localhost:11434/v1',
  model: '',
  apiKey: '',
};

function parseConfig(value: string | null): BrowserModelConfig | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    if (parsed?.source !== 'ONLINE' && parsed?.source !== 'OLLAMA') return null;
    return {
      source: parsed.source,
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : DEFAULT_BROWSER_MODEL_CONFIG.baseUrl,
      model: typeof parsed.model === 'string' ? parsed.model : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
    };
  } catch {
    return null;
  }
}

function conversationConfigKey(conversationId: string) {
  return `${CONVERSATION_CONFIG_PREFIX}${conversationId}`;
}

export function readBrowserModelConfig(conversationId?: string | null): {
  config: BrowserModelConfig;
  scope: BrowserModelScope;
} {
  if (conversationId) {
    const conversationConfig = parseConfig(localStorage.getItem(conversationConfigKey(conversationId)));
    if (conversationConfig) return { config: conversationConfig, scope: 'CONVERSATION' };
  }

  return {
    config: parseConfig(localStorage.getItem(GLOBAL_CONFIG_KEY)) || DEFAULT_BROWSER_MODEL_CONFIG,
    scope: 'GLOBAL',
  };
}

export function readBrowserModelConfigForScope(scope: BrowserModelScope, conversationId?: string | null) {
  if (scope === 'CONVERSATION' && conversationId) {
    return (
      parseConfig(localStorage.getItem(conversationConfigKey(conversationId))) ||
      parseConfig(localStorage.getItem(GLOBAL_CONFIG_KEY)) ||
      DEFAULT_BROWSER_MODEL_CONFIG
    );
  }

  return parseConfig(localStorage.getItem(GLOBAL_CONFIG_KEY)) || DEFAULT_BROWSER_MODEL_CONFIG;
}

export function saveBrowserModelConfig(
  config: BrowserModelConfig,
  scope: BrowserModelScope,
  conversationId?: string | null
) {
  const normalized = {
    ...config,
    baseUrl: config.baseUrl.trim().replace(/\/+$/, ''),
    model: config.model.trim(),
    apiKey: config.apiKey.trim(),
  };

  if (normalized.source === 'OLLAMA') {
    if (!normalized.baseUrl || !normalized.model) throw new Error('请填写 Ollama Base URL 和模型名称');
    try {
      const url = new URL(normalized.baseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
    } catch {
      throw new Error('请输入有效的 HTTP 或 HTTPS Base URL');
    }
  }

  if (scope === 'CONVERSATION') {
    if (!conversationId) throw new Error('当前会话尚未创建');
    localStorage.setItem(conversationConfigKey(conversationId), JSON.stringify(normalized));
  } else {
    localStorage.setItem(GLOBAL_CONFIG_KEY, JSON.stringify(normalized));
    if (conversationId) localStorage.removeItem(conversationConfigKey(conversationId));
  }

  return normalized;
}

function completionUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, '');
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

function parseStreamLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return '';
  const data = trimmed.slice(5).trim();
  if (!data || data === '[DONE]') return '';

  try {
    const chunk = JSON.parse(data);
    return chunk.choices?.[0]?.delta?.content || '';
  } catch {
    return '';
  }
}

export async function streamBrowserModel({
  config,
  messages,
  signal,
}: {
  config: BrowserModelConfig;
  messages: ModelMessage[];
  signal?: AbortSignal;
}): Promise<ReadableStream<Uint8Array>> {
  let response: Response;
  try {
    response = await fetch(completionUrl(config.baseUrl), {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: config.model, messages, stream: true }),
      signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error;
    throw new Error('无法从浏览器连接 Ollama，请检查 Base URL、Ollama 服务和 OLLAMA_ORIGINS');
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `Ollama 请求失败：HTTP ${response.status}`);
  }
  if (!response.body) throw new Error('Ollama 没有返回响应流');

  const source = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await source.read();
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';

          for (const line of lines) {
            const content = parseStreamLine(line);
            if (content) controller.enqueue(encoder.encode(content));
          }

          if (done) break;
        }

        const content = parseStreamLine(buffer);
        if (content) controller.enqueue(encoder.encode(content));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      return source.cancel();
    },
  });
}
