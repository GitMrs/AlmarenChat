import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMcpServers } from './mcp-config.mjs';

test('parses and bounds remote MCP configuration', () => {
  const servers = parseMcpServers(JSON.stringify([
    { id: 'research main', url: 'https://mcp.example.test/rpc', headers: { Authorization: 'Bearer token', bad_key: 1 } },
    { id: 'local', url: 'http://127.0.0.1:8787/rpc' },
    { id: 'insecure', url: 'http://mcp.example.test/rpc' },
  ]));
  assert.equal(servers.length, 2);
  assert.equal(servers[0].id, 'research_main');
  assert.equal(servers[0].headers.Authorization, 'Bearer token');
});

test('invalid MCP configuration is ignored', () => {
  assert.deepEqual(parseMcpServers('{bad'), []);
  assert.deepEqual(parseMcpServers([{ id: 'x', url: 'file:///tmp/mcp' }]), []);
});
