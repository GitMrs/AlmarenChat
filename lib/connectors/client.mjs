import { createHttpMcpClient } from '../agents/runtime/mcp-client.mjs';
import { createFeishuCliClient, FEISHU_URL } from './feishu-cli.mjs';
import { createPersonalMailClient, MAIL_URL } from './personal-mail.mjs';

export function createConnectorClient(server) {
  if (server.url === FEISHU_URL) return createFeishuCliClient(server);
  if (server.url === MAIL_URL) return createPersonalMailClient(server);
  return createHttpMcpClient(server);
}
