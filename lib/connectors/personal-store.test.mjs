import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { migratePersonalConnectors } from './migrate-personal.mjs';
import { connectorHeaders, deletePersonalConnector, listConnectorBindings, listPersonalConnectors, resolvePersonalConnectorServers, savePersonalConnector, setConnectorBinding } from './personal-store.mjs';
import { resolveSpaceConnectorServersSync } from './space-servers.mjs';
import { createAssistantToolBroker } from '../personal-assistant/tool-broker.mjs';

const migration = readFileSync(new URL('../../prisma/migrations/20261112100000_add_personal_connectors/migration.sql', import.meta.url), 'utf8');
function fixture() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec('CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "assistantMcpServers" TEXT); CREATE TABLE "Space" ("id" TEXT PRIMARY KEY, "userId" TEXT); CREATE TABLE "SpaceMcpServer" ("id" TEXT PRIMARY KEY, "spaceId" TEXT, "name" TEXT, "url" TEXT, "headersCiphertext" TEXT, "enabled" INTEGER, "createdAt" TEXT);');
  sqlite.exec(migration);
  sqlite.exec("INSERT INTO User VALUES ('alice',NULL),('bob',NULL); INSERT INTO Space VALUES ('a','alice'),('b','alice'),('bob-space','bob');");
  const db = {
    $queryRawUnsafe: async (sql, ...params) => sqlite.prepare(sql).all(...params),
    $executeRawUnsafe: async (sql, ...params) => sqlite.prepare(sql).run(...params).changes,
    $transaction: async callback => {
      sqlite.exec('BEGIN');
      try { const result = await callback(db); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, db, close: () => sqlite.close() };
}
const input = { toolId: 'docs', name: '文档连接', url: 'https://mcp.example.test/mcp', headers: { Authorization: 'Bearer test-secret' } };
process.env.SPACE_CONNECTOR_SECRET = 'connector-unit-test-secret-at-least-32-characters';

test('mailbox credentials stay encrypted, edits preserve them and user/scope bindings control lazy tools', async () => {
  const f = fixture();
  try {
    const data = { toolId: 'personal-mail', name: '邮箱', url: 'connector:personal-mail', catalogId: 'personal-mail', headers: { provider: '126', email: 'alice@126.com', password: 'mail-private-code' } };
    const saved = await savePersonalConnector(f.db, 'alice', data);
    const row = f.sqlite.prepare('SELECT * FROM PersonalConnector WHERE id = ?').get(saved.id);
    assert.doesNotMatch(JSON.stringify(saved), /mail-private-code|alice@126/);
    assert.doesNotMatch(row.headersCiphertext, /mail-private-code/);
    assert.deepEqual(await resolvePersonalConnectorServers(f.db, 'alice', 'assistant'), []);
    await setConnectorBinding(f.db, 'alice', 'agent', 'lulu', saved.id, true);
    const servers = await resolvePersonalConnectorServers(f.db, 'alice', 'agent', 'lulu');
    assert.equal(servers[0].headers.password, data.headers.password);
    assert.deepEqual(await resolvePersonalConnectorServers(f.db, 'alice', 'agent', 'other'), []);
    assert.deepEqual(await resolvePersonalConnectorServers(f.db, 'bob', 'agent', 'lulu'), []);
    await assert.rejects(savePersonalConnector(f.db, 'bob', data, saved.id), /不存在/);
    const broker = createAssistantToolBroker({ servers });
    await broker.call('mcp_load', { serverId: 'personal-mail' });
    assert.ok(broker.modelTools().some(tool => tool.function.name.endsWith('_search_emails')));
    assert.doesNotMatch(JSON.stringify(broker.modelTools()), /mail-private-code|alice@126/);
    await savePersonalConnector(f.db, 'alice', { ...data, headers: undefined, name: '新邮箱名' }, saved.id);
    assert.deepEqual(connectorHeaders(f.sqlite.prepare('SELECT * FROM PersonalConnector WHERE id = ?').get(saved.id)), data.headers);
    await assert.rejects(savePersonalConnector(f.db, 'alice', { ...data, headers: { ...data.headers, email: 'alice@163.com' } }, saved.id), /完整邮箱地址/);
    await setConnectorBinding(f.db, 'alice', 'agent', 'lulu', saved.id, false);
    assert.deepEqual(await resolvePersonalConnectorServers(f.db, 'alice', 'agent', 'lulu'), []);
  } finally { f.close(); }
});

test('Feishu credentials are encrypted and bound metadata reaches the lazy CLI adapter without exposing credentials to the model', async () => {
  const f = fixture();
  try {
    const data = { toolId: 'feishu-cli', name: '飞书', url: 'connector:feishu-cli', catalogId: 'feishu-cli', headers: { appId: 'cli_test', appSecret: 'feishu-private-secret' } };
    const saved = await savePersonalConnector(f.db, 'alice', data);
    assert.doesNotMatch(JSON.stringify(saved), /feishu-private-secret/);
    assert.deepEqual(await resolvePersonalConnectorServers(f.db, 'alice', 'agent', 'lulu'), []);
    await setConnectorBinding(f.db, 'alice', 'agent', 'lulu', saved.id, true);
    const servers = await resolvePersonalConnectorServers(f.db, 'alice', 'agent', 'lulu');
    assert.equal(servers[0].connectorId, saved.id); assert.equal(servers[0].scopeId, 'lulu');
    const broker = createAssistantToolBroker({ servers });
    assert.equal(broker.modelTools().length, 1);
    await broker.call('mcp_load', { serverId: 'feishu-cli' });
    assert.ok(broker.modelTools().some(tool => tool.function.name.endsWith('_run')));
    assert.doesNotMatch(JSON.stringify(broker.modelTools()), /feishu-private-secret/);
    await savePersonalConnector(f.db, 'alice', { ...data, headers: undefined, name: '新名称' }, saved.id);
    assert.equal((await resolvePersonalConnectorServers(f.db, 'alice', 'agent', 'lulu'))[0].headers.appSecret, data.headers.appSecret);
    await assert.rejects(savePersonalConnector(f.db, 'bob', { ...input, catalogId: 'feishu-cli' }), /请填写有效/);
  } finally { f.close(); }
});

test('new connections are encrypted, not bound, and credentials are preserved or explicitly cleared on edit', async () => {
  const f = fixture();
  try {
    const saved = await savePersonalConnector(f.db, 'alice', input);
    const row = f.sqlite.prepare('SELECT * FROM PersonalConnector').get();
    assert.ok(row.headersCiphertext.startsWith('v1.'));
    assert.equal(row.headersCiphertext.includes('test-secret'), false);
    assert.equal(JSON.stringify(await listPersonalConnectors(f.db, 'alice')).includes('test-secret'), false);
    assert.equal(saved.hasHeaders, true);
    assert.deepEqual(await resolvePersonalConnectorServers(f.db, 'alice', 'assistant'), []);
    await savePersonalConnector(f.db, 'alice', { ...input, headers: undefined, name: '新名称' }, saved.id);
    assert.deepEqual(connectorHeaders(f.sqlite.prepare('SELECT * FROM PersonalConnector').get()), input.headers);
    await savePersonalConnector(f.db, 'alice', { ...input, headers: {} }, saved.id);
    assert.equal(f.sqlite.prepare('SELECT headersCiphertext FROM PersonalConnector').get().headersCiphertext, null);
    await assert.rejects(savePersonalConnector(f.db, 'bob', input, saved.id), /不存在/);
    await assert.rejects(savePersonalConnector(f.db, 'alice', { ...input, toolId: 'bad', headers: { X: 'bad\r\nvalue' } }), /请求头/);
  } finally { f.close(); }
});

test('assistant, each agent, spaces and users have independent bindings; deletion removes every binding', async () => {
  const f = fixture();
  try {
    const { id } = await savePersonalConnector(f.db, 'alice', input);
    for (const [scope, scopeId] of [['assistant', undefined], ['agent', 'lulu'], ['space', 'a']]) await setConnectorBinding(f.db, 'alice', scope, scopeId, id, true);
    assert.equal((await resolvePersonalConnectorServers(f.db, 'alice', 'assistant')).length, 1);
    assert.equal((await resolvePersonalConnectorServers(f.db, 'alice', 'agent', 'lulu')).length, 1);
    assert.deepEqual(await resolvePersonalConnectorServers(f.db, 'alice', 'agent', 'other'), []);
    assert.deepEqual(await resolvePersonalConnectorServers(f.db, 'alice', 'space', 'b'), []);
    assert.deepEqual(await listPersonalConnectors(f.db, 'bob'), []);
    await assert.rejects(setConnectorBinding(f.db, 'bob', 'assistant', undefined, id, true), /不存在/);
    await setConnectorBinding(f.db, 'alice', 'assistant', undefined, id, false);
    assert.deepEqual(await resolvePersonalConnectorServers(f.db, 'alice', 'assistant'), []);
    assert.equal(resolveSpaceConnectorServersSync(f.sqlite, 'alice', 'a').length, 1);
    assert.throws(() => resolveSpaceConnectorServersSync(f.sqlite, 'bob', 'a'), /授权无效/);
    await deletePersonalConnector(f.db, 'bob', id);
    assert.equal((await listPersonalConnectors(f.db, 'alice')).length, 1);
    await deletePersonalConnector(f.db, 'alice', id);
    assert.deepEqual(await listConnectorBindings(f.db, 'alice', 'agent', 'lulu'), []);
    assert.deepEqual(resolveSpaceConnectorServersSync(f.sqlite, 'alice', 'a'), []);
  } finally { f.close(); }
});

test('migration preserves enabled assistant usage only, clears legacy plaintext and is repeatable', async () => {
  const f = fixture();
  try {
    f.sqlite.prepare('UPDATE User SET assistantMcpServers = ? WHERE id = ?').run(JSON.stringify([input, { id: 'off', url: input.url, enabled: false }].map(item => ({ ...item, id: item.id || item.toolId }))), 'alice');
    assert.equal(migratePersonalConnectors(f.sqlite), 2);
    assert.equal(migratePersonalConnectors(f.sqlite), 0);
    assert.equal((await listPersonalConnectors(f.db, 'alice')).length, 2);
    assert.equal((await resolvePersonalConnectorServers(f.db, 'alice', 'assistant')).length, 1);
    assert.deepEqual(await resolvePersonalConnectorServers(f.db, 'alice', 'agent', 'lulu'), []);
    assert.equal(f.sqlite.prepare('SELECT assistantMcpServers FROM User WHERE id = ?').get('alice').assistantMcpServers, null);
    const { id } = (await listPersonalConnectors(f.db, 'alice')).find(item => item.toolId === 'docs');
    await setConnectorBinding(f.db, 'alice', 'assistant', undefined, id, false);
    migratePersonalConnectors(f.sqlite);
    assert.deepEqual(await resolvePersonalConnectorServers(f.db, 'alice', 'assistant'), []);
  } finally { f.close(); }
});

test('migration rolls back without the encryption secret, preserving old data for a safe retry', () => {
  const f = fixture();
  const secret = process.env.SPACE_CONNECTOR_SECRET;
  try {
    f.sqlite.prepare('UPDATE User SET assistantMcpServers = ? WHERE id = ?').run(JSON.stringify([{ id: 'docs', url: input.url, headers: input.headers }]), 'alice');
    delete process.env.SPACE_CONNECTOR_SECRET;
    assert.throws(() => migratePersonalConnectors(f.sqlite), /SPACE_CONNECTOR_SECRET/);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM PersonalConnector').get().n, 0);
    assert.ok(f.sqlite.prepare('SELECT assistantMcpServers FROM User WHERE id = ?').get('alice').assistantMcpServers);
    process.env.SPACE_CONNECTOR_SECRET = secret;
    assert.equal(migratePersonalConnectors(f.sqlite), 1);
  } finally { process.env.SPACE_CONNECTOR_SECRET = secret; f.close(); }
});

test('binding revocation prevents an already-loaded broker from executing remote operations', async () => {
  const f = fixture();
  try {
    const { id } = await savePersonalConnector(f.db, 'alice', input);
    await setConnectorBinding(f.db, 'alice', 'assistant', undefined, id, true);
    let calls = 0;
    const broker = createAssistantToolBroker({
      servers: await resolvePersonalConnectorServers(f.db, 'alice', 'assistant'),
      authorizeServer: async serverId => {
        const current = (await resolvePersonalConnectorServers(f.db, 'alice', 'assistant')).find(item => item.id === serverId);
        if (!current) throw new Error('此连接器已关闭');
        return current;
      },
      clientFactory: () => ({ listTools: async () => [{ name: 'read', inputSchema: { type: 'object' } }], callTool: async () => { calls++; return { ok: true }; } }),
    });
    assert.deepEqual(broker.modelTools().map(item => item.function.name), ['mcp_load']);
    await broker.call('mcp_load', { serverId: 'docs' });
    await broker.call('mcp_docs_read');
    assert.equal(calls, 1);
    await setConnectorBinding(f.db, 'alice', 'assistant', undefined, id, false);
    await assert.rejects(broker.call('mcp_docs_read'), /已关闭/);
    await assert.rejects(broker.call('mcp_load', { serverId: 'docs' }), /已关闭/);
    assert.equal(calls, 1);
  } finally { f.close(); }
});

test('built-in instances have a single added state, which resets on deletion', async () => {
  const f = fixture();
  try {
    const first = await savePersonalConnector(f.db, 'alice', { ...input, catalogId: 'http-mcp' });
    await assert.rejects(savePersonalConnector(f.db, 'alice', { ...input, toolId: 'second', catalogId: 'http-mcp' }), /已添加/);
    await deletePersonalConnector(f.db, 'alice', first.id);
    assert.equal((await savePersonalConnector(f.db, 'alice', { ...input, catalogId: 'http-mcp' })).catalogId, 'http-mcp');
  } finally { f.close(); }
});

test('invalid legacy configuration stops migration instead of silently dropping data', () => {
  const f = fixture();
  try {
    const legacy = JSON.stringify([{ id: 'broken', url: 'not-a-url' }]);
    f.sqlite.prepare('UPDATE User SET assistantMcpServers = ? WHERE id = ?').run(legacy, 'alice');
    assert.throws(() => migratePersonalConnectors(f.sqlite), /无效条目/);
    assert.equal(f.sqlite.prepare('SELECT assistantMcpServers FROM User WHERE id = ?').get('alice').assistantMcpServers, legacy);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM PersonalConnector').get().n, 0);
  } finally { f.close(); }
});
