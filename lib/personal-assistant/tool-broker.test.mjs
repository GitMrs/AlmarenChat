import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssistantToolBroker } from './tool-broker.mjs';

test('assistant tool broker discovers namespaced MCP tools and invokes them', async () => {
  const calls = [];
  const broker = createAssistantToolBroker({
    servers: [{ id: 'baidu-map', url: 'https://mcp.example.test' }],
    clientFactory: () => ({
      listTools: async () => [{ name: 'transit_arrival', description: '查询公交到站' }],
      callTool: async (name, args) => {
        calls.push({ name, args });
        return { content: [{ type: 'text', text: '约 5 分钟' }] };
      },
    }),
  });

  const tools = await broker.discover();
  assert.equal(tools[0].name, 'mcp_baidu-map_transit_arrival');
  assert.deepEqual(await broker.call(tools[0].name, { station: '知春路' }), {
    content: [{ type: 'text', text: '约 5 分钟' }],
  });
  assert.deepEqual(calls, [{ name: 'transit_arrival', args: { station: '知春路' } }]);
});

test('assistant tool broker rejects tools that were not discovered', async () => {
  const broker = createAssistantToolBroker({
    servers: [{ id: 'map', url: 'https://mcp.example.test' }],
    clientFactory: () => ({ listTools: async () => [], callTool: async () => ({}) }),
  });
  await broker.discover();
  await assert.rejects(() => broker.call('mcp_map_unknown'), /没有可用工具/);
});
