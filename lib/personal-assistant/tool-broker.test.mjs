import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssistantToolBroker } from './tool-broker.mjs';
import { createAutoWebTools, runAutoWebChat } from '../web/auto-web-core.mjs';

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

test('assistant tool broker skips disabled MCP servers', async () => {
  const broker = createAssistantToolBroker({
    servers: [
      { id: 'disabled_server', url: 'https://mcp.disabled.test', enabled: false },
      { id: 'active_server', url: 'https://mcp.active.test', enabled: true },
    ],
    clientFactory: ({ url }) => ({
      listTools: async () => [{ name: url.includes('active') ? 'active_tool' : 'disabled_tool' }],
      callTool: async () => ({}),
    }),
  });
  const tools = await broker.discover();
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'mcp_active_server_active_tool');
});

test('MCP loads only the selected enabled service and caches its schemas for the turn', async () => {
  const discoveries = [];
  const broker = createAssistantToolBroker({
    servers: [{ id: 'map', url: 'https://map.test' }, { id: 'other', url: 'https://other.test' }, { id: 'disabled', url: 'https://disabled.test', enabled: false }],
    clientFactory: ({ url }) => ({
      listTools: async () => { discoveries.push(url); return [{ name: 'lookup', inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } } }]; },
      callTool: async () => ({ ok: true }),
    }),
  });
  assert.deepEqual(discoveries, []);
  assert.deepEqual(broker.modelTools().map((tool) => tool.function.name), ['mcp_load']);
  await assert.rejects(broker.call('mcp_map_lookup'), /没有可用工具/);
  await assert.rejects(broker.call('mcp_load', { serverId: 'disabled' }), /未启用/);
  await Promise.all([broker.call('mcp_load', { serverId: 'map' }), broker.call('mcp_load', { serverId: 'map' })]);
  await broker.call('mcp_load', { serverId: 'map' });
  assert.deepEqual(discoveries, ['https://map.test']);
  const remote = broker.modelTools().find((tool) => tool.function.name === 'mcp_map_lookup');
  assert.deepEqual(remote.function.parameters.required, ['query']);
  assert.equal(JSON.stringify(broker.modelTools()).includes('https://map.test'), false);
});

test('assistant model can load an MCP service then call it in the same tool loop', async () => {
  let executions = 0;
  const broker = createAssistantToolBroker({
    servers: [{ id: 'map', url: 'https://map.test' }],
    clientFactory: () => ({ listTools: async () => [{ name: 'lookup', inputSchema: { type: 'object' } }], callTool: async () => { executions += 1; return { ok: true }; } }),
  });
  let round = 0;
  const requests = [];
  const client = { chat: { completions: { create: async function* (body) {
    requests.push(body.tools.map((tool) => tool.function.name));
    round += 1;
    if (round < 3) yield { choices: [{ delta: { tool_calls: [{ index: 0, id: `mcp-${round}`, type: 'function', function: {
      name: round === 1 ? 'mcp_load' : 'mcp_map_lookup', arguments: round === 1 ? '{"serverId":"map"}' : '{}',
    } }] } }] };
    else yield { choices: [{ delta: { content: '查询完成。' } }] };
  } } } };
  const output = await runAutoWebChat({ client, model: 'test', messages: [{ role: 'user', content: '查公交' }],
    web: createAutoWebTools({ availableToolNames: [] }), extraTools: broker.modelTools(), getExtraTools: broker.modelTools, callTool: broker.call });
  assert.deepEqual(requests[0], ['mcp_load']);
  assert.deepEqual(requests[1], ['mcp_load', 'mcp_map_lookup']);
  assert.equal(executions, 1);
  assert.equal(output, '查询完成。');
});

