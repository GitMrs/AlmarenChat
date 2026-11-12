import { createHttpMcpClient } from '../agents/runtime/mcp-client.mjs';
import { createFeishuCliClient, FEISHU_URL } from './feishu-cli.mjs';

export function createConnectorClient(server) {
  if (server.url === FEISHU_URL) return createFeishuCliClient(server);
  return createHttpMcpClient(server);
}
