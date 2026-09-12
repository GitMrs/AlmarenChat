const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TOOLS = 32;

function safeUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('MCP 地址必须使用 HTTPS');
  }
  return url;
}

export function createHttpMcpClient({ url, headers = {}, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const endpoint = safeUrl(url).toString();
  let requestId = 0;
  async function request(method, params = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`MCP 请求失败：HTTP ${response.status}`);
      const payload = await response.json();
      if (payload?.error) throw new Error(`MCP ${method} 失败：${payload.error.message || '未知错误'}`);
      return payload?.result || {};
    } finally {
      clearTimeout(timer);
    }
  }
  return Object.freeze({
    async listTools() {
      const result = await request('tools/list');
      return Array.isArray(result.tools) ? result.tools.slice(0, MAX_TOOLS) : [];
    },
    callTool(name, argumentsValue = {}) {
      return request('tools/call', { name: String(name), arguments: argumentsValue });
    },
  });
}

export function mcpToolName(serverId, toolName) {
  const normalize = (value) => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'mcp';
  return `mcp_${normalize(serverId)}_${normalize(toolName)}`.slice(0, 64);
}
