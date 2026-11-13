import assert from 'node:assert/strict';
import test from 'node:test';
import { createPiConnectorQueryTools } from './pi-query-tools.mjs';
import { createAssistantToolBroker } from '../personal-assistant/tool-broker.mjs';

test('Pi can load and call connector tools through fixed tools without eager discovery', async () => {
  let discoveries = 0;
  let calls = 0;
  const broker = createAssistantToolBroker({
    servers: [{ id: 'docs', url: 'https://example.test/mcp' }],
    clientFactory: () => ({ instructions: 'Read the specified document directly.', listTools: async () => { discoveries++; return [{ name: 'read', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } }]; }, callTool: async () => { calls++; return { ok: true }; } }),
  });
  const bridge = createPiConnectorQueryTools(broker);
  assert.equal(discoveries, 0);
  assert.deepEqual(bridge.tools.map(tool => tool.function.name), ['mcp_load', 'mcp_call']);
  await assert.rejects(bridge.execute('mcp_call', { toolName: 'mcp_docs_read', args: {} }), /未获授权/);
  const loaded = await bridge.execute('mcp_load', { serverId: 'docs' });
  assert.equal(loaded.tools[0].name, 'mcp_docs_read');
  assert.equal(loaded.instructions, 'Read the specified document directly.');
  assert.ok(loaded.tools[0].parameters.properties.id);
  assert.equal(calls, 0);
  await bridge.execute('mcp_call', { toolName: 'mcp_docs_read', args: { id: 'one' } });
  assert.equal(calls, 1);
  await assert.rejects(bridge.execute('mcp_call', { toolName: 'mcp_other_write', args: {} }), /未获授权/);
});
