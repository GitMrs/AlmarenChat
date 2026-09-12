import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpMcpClient, mcpToolName } from './mcp-client.mjs';

test('HTTP MCP client lists and calls tools through JSON-RPC', async () => {
  const requests = [];
  const client = createHttpMcpClient({
    url: 'https://mcp.example.test/tools',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      return { ok: true, json: async () => ({ jsonrpc: '2.0', id: body.id, result: body.method === 'tools/list' ? { tools: [{ name: 'lookup', inputSchema: { type: 'object' } }] } : { content: [{ type: 'text', text: 'ok' }] } }) };
    },
  });
  assert.equal((await client.listTools())[0].name, 'lookup');
  assert.equal((await client.callTool('lookup', { q: 'x' })).content[0].text, 'ok');
  assert.deepEqual(requests.map((item) => item.method), ['tools/list', 'tools/call']);
});

test('HTTP MCP client rejects insecure remote endpoints', () => {
  assert.throws(() => createHttpMcpClient({ url: 'http://mcp.example.test' }), /HTTPS/);
  assert.equal(mcpToolName('wechat-main', 'draft.create'), 'mcp_wechat-main_draft_create');
});
