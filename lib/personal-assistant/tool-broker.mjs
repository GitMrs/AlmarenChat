import { createHttpMcpClient, mcpToolName } from '../agent-runtime/mcp-client.mjs';

const MAX_SERVERS = 8;
const MAX_TOOLS_PER_SERVER = 32;

function normalizeServers(servers) {
  if (!Array.isArray(servers)) return [];
  return servers.slice(0, MAX_SERVERS).flatMap((server) => {
    const id = String(server?.id || '').trim();
    const url = String(server?.url || '').trim();
    if (!id || !url) return [];
    return [{ id, url, headers: server?.headers || {} }];
  });
}

/**
 * Account-scoped tool boundary for the personal assistant. Skills can declare
 * required tool names without knowing whether a tool comes from MCP or an
 * internal connector.
 */
export function createAssistantToolBroker({ servers = [], clientFactory = createHttpMcpClient, maxTools = 128 } = {}) {
  const clients = new Map();
  const tools = new Map();

  async function discover() {
    tools.clear();
    for (const server of normalizeServers(servers)) {
      const client = clientFactory({ url: server.url, headers: server.headers });
      const remoteTools = await client.listTools();
      clients.set(server.id, client);
      for (const definition of remoteTools.slice(0, MAX_TOOLS_PER_SERVER)) {
        const remoteName = String(definition?.name || '').trim();
        if (!remoteName || tools.size >= maxTools) continue;
        const name = mcpToolName(server.id, remoteName);
        tools.set(name, { name, serverId: server.id, remoteName, definition });
      }
    }
    return [...tools.values()].map(({ name, definition }) => ({ ...definition, name }));
  }

  async function call(name, argumentsValue = {}) {
    const entry = tools.get(String(name || ''));
    if (!entry) throw new Error(`小伴没有可用工具：${String(name || '')}`);
    const client = clients.get(entry.serverId);
    if (!client) throw new Error(`MCP 服务不可用：${entry.serverId}`);
    return client.callTool(entry.remoteName, argumentsValue);
  }

  return Object.freeze({ discover, call });
}
