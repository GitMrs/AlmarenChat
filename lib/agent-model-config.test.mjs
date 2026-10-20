import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import Database from 'better-sqlite3';
import { resolveAgentModelConfig } from './agent-model-config.mjs';

const require = createRequire(import.meta.url);
const defaults = { modelName: 'system', apiBaseUrl: 'https://system.test/v1', apiKey: 'system-secret' };
const user = { customModelEnabled: true, modelName: 'global-a', apiBaseUrl: 'https://global.test/v1', apiKey: 'global-secret' };
const role = { modelName: 'role-b', apiBaseUrl: 'https://role.test/v1', apiKey: 'role-secret' };
const config = (agentSetting, member, owner = user) => resolveAgentModelConfig({ user: owner, agentSetting, member, defaults });

async function loadTs(file, mocks) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, process: { env: {} }, console, URL, Response, Error,
    require: name => name in mocks ? mocks[name] : name.startsWith('node:') ? require(name) : (() => { throw Error(name); })(),
  });
  return exports;
}

test('model inheritance is dynamic, field by field, and never mutates role or global defaults', () => {
  const member = { modelName: 'space-c', apiKey: ' ' };
  assert.deepEqual(config(role, member), { ...role, modelName: 'space-c', source: 'SPACE', usesCustomModel: true });
  assert.equal(config(role).modelName, 'role-b');
  assert.equal(config({ ...role, modelName: 'role-d' }).modelName, 'role-d');
  assert.equal(config({ ...role, modelName: 'role-d' }, member).modelName, 'space-c');
  assert.equal(config({}, { modelName: null, apiKey: '', apiBaseUrl: null }).modelName, 'global-a');
  assert.deepEqual(config(null, null, { ...user, customModelEnabled: false }), { ...defaults, source: 'SYSTEM', usesCustomModel: false });
  assert.equal(config({ modelName: 'role-only' }, null, null).usesCustomModel, false);
  assert.equal(config({ apiKey: 'own-key' }, null, null).usesCustomModel, true);
  assert.equal(role.modelName, 'role-b');
  assert.equal(user.modelName, 'global-a');
});

test('migration supports built-in agents and separates users with cascading cleanup', async () => {
  const db = new Database(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON; CREATE TABLE "User" ("id" TEXT PRIMARY KEY); INSERT INTO "User" VALUES (\'alice\'), (\'bob\');');
    db.exec(await readFile(new URL('../prisma/migrations/20261020120000_add_agent_model_settings/migration.sql', import.meta.url), 'utf8'));
    const insert = db.prepare('INSERT INTO "AgentModelSetting" (id, userId, agentId, modelName, updatedAt) VALUES (?, ?, ?, ?, ?)');
    insert.run('a', 'alice', 'fx-kurumi', 'role-a', '2026-10-20');
    insert.run('b', 'bob', 'fx-kurumi', 'role-b', '2026-10-20');
    assert.throws(() => insert.run('c', 'alice', 'fx-kurumi', 'duplicate', '2026-10-20'), /UNIQUE/);
    db.prepare('DELETE FROM "User" WHERE id = ?').run('alice');
    assert.deepEqual(db.prepare('SELECT userId, modelName FROM "AgentModelSetting"').all(), [{ userId: 'bob', modelName: 'role-b' }]);
  } finally { db.close(); }
});

test('role model API authenticates, validates and only changes the requesting user defaults', async () => {
  const records = new Map();
  const writes = [];
  const key = ({ userId, agentId }) => `${userId}/${agentId}`;
  const db = {
    user: { findUnique: async () => user },
    agentModelSetting: { upsert: async options => {
      const identity = options.where.userId_agentId;
      writes.push(identity);
      const previous = records.get(key(identity));
      records.set(key(identity), previous ? { ...previous, ...options.update } : { ...options.create });
    } },
  };
  const route = await loadTs('../app/api/agents/[agentId]/model-settings/route.ts', {
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/app/api/_lib/auth': { requireAuth: request => { const id = request.headers.get('Authorization'); if (!id) throw Error('Unauthorized'); return id; } },
    '@/app/api/_lib/db': { default: db },
    '@/app/api/_lib/spaces': { resolveAgent: async id => ['fx-kurumi', 'custom-agent'].includes(id) ? { id } : null },
    '@/app/api/_lib/agent-model': {
      loadAgentModelSetting: async (userId, agentId) => records.get(key({ userId, agentId })) || null,
      resolveUserModelConfig: (owner, setting) => resolveAgentModelConfig({ user: owner, agentSetting: setting, defaults }),
    },
  });
  const call = (method, owner = 'alice', body = {}, agentId = 'fx-kurumi') => route[method](new Request('http://test/model-settings', {
    method, headers: owner ? { Authorization: owner } : {}, ...(method === 'PATCH' ? { body: JSON.stringify(body) } : {}),
  }), { params: Promise.resolve({ agentId }) });
  assert.equal((await call('GET', '')).status, 401);
  assert.equal((await call('PATCH', 'alice', role, 'private-or-unknown')).status, 404);
  assert.equal((await call('PATCH', 'alice', { modelName: 42 })).status, 400);
  assert.equal((await call('PATCH', 'alice', { apiBaseUrl: 'file:///secret' })).status, 400);
  assert.equal(writes.length, 0);
  for (const agentId of ['fx-kurumi', 'custom-agent']) {
    assert.equal((await call('PATCH', 'alice', role, agentId)).status, 200);
    const other = await (await call('GET', 'bob', {}, agentId)).json();
    assert.equal(other.settings, null);
    assert.equal(other.effective.modelName, 'global-a');
  }
  const response = await call('GET');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const profile = await response.json();
  assert.equal(profile.effective.modelName, 'role-b');
  assert.equal(profile.inherited.modelName, 'global-a');
  assert.equal(profile.effective.apiKey, undefined);
  assert.equal(profile.inherited.apiKey, undefined);
  await call('PATCH', 'alice', { modelName: 'new-model' });
  assert.equal((await (await call('GET')).json()).settings.apiKey, 'role-secret');
  await call('PATCH', 'alice', { modelName: null, apiBaseUrl: null, apiKey: null });
  assert.equal((await (await call('GET')).json()).effective.modelName, 'global-a');
});

test('space resolver and model connection tools use the same role inheritance under the owner identity', async () => {
  const reads = [];
  const modelService = {
    loadAgentModelSetting: async (userId, agentId) => { reads.push({ userId, agentId }); return role; },
    resolveUserModelConfig: (owner, setting, member) => resolveAgentModelConfig({ user: owner, agentSetting: setting, member, defaults }),
  };
  const spaces = await loadTs('../app/api/_lib/spaces.ts', {
    '@/app/api/_lib/db': { default: { user: { findUnique: async () => user }, agent: { findUnique: async () => null } } },
    '@/lib/agents-data': { getBuiltInAgents: async () => [{ id: 'fx-kurumi', name: '久留美' }] },
    '@/lib/model-client': { DEFAULT_BASE_URL: defaults.apiBaseUrl, DEFAULT_MODEL: defaults.modelName, resolveModelName: name => name, createModelClient: (url, key) => ({ url, key }) },
    '@/app/api/_lib/agent-model': modelService,
  });
  const space = { userId: 'alice', members: [{ agentId: 'fx-kurumi', modelName: 'space-c' }] };
  const resolved = await spaces.resolveSpaceMemberModelConfig({ spaceId: 'space', agentId: 'fx-kurumi', space });
  assert.equal(resolved.effectiveModelName, 'space-c');
  assert.equal(resolved.effectiveApiBaseUrl, role.apiBaseUrl);
  assert.equal(resolved.effectiveApiKey, role.apiKey);
  space.members[0].modelName = null;
  assert.equal((await spaces.resolveSpaceMemberModelConfig({ spaceId: 'space', agentId: 'fx-kurumi', space })).effectiveModelName, 'role-b');
  assert.deepEqual(reads[0], { userId: 'alice', agentId: 'fx-kurumi' });
  const tools = await loadTs('../app/api/_lib/model-request.ts', {
    '@/app/api/_lib/db': { default: { user: { findUnique: async () => user } } },
    '@/app/api/_lib/spaces': { resolveAgent: async id => id === 'fx-kurumi' ? { id } : null },
    '@/app/api/_lib/agent-model': modelService,
  });
  const inherited = await tools.resolveModelRequestConfig('alice', { agentId: 'fx-kurumi', inheritAgentModel: true, modelName: 'space-c' });
  assert.equal(inherited.apiKey, resolved.effectiveApiKey);
  assert.equal(inherited.apiBaseUrl, resolved.effectiveApiBaseUrl);
  assert.equal(inherited.modelName, resolved.effectiveModelName);
  const roleEdit = await tools.resolveModelRequestConfig('alice', { agentId: 'fx-kurumi', inheritAgentModel: false, modelName: 'new-role' });
  assert.equal(roleEdit.apiKey, user.apiKey, 'blank role credentials inherit global values, never old saved role credentials');
  await assert.rejects(tools.resolveModelRequestConfig('alice', { agentId: 'private' }), /Agent not found/);
});

test('worker space participants inherit their owner role settings without changing coordinator or other users', async () => {
  const source = await readFile(new URL('../worker/agent-runtime.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function loadRunContext(run) {');
  const end = source.indexOf('  const usesCoordinatorAdvisor', start);
  assert.ok(start >= 0 && end > start);
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE "User" (id TEXT PRIMARY KEY, customModelEnabled INTEGER, apiBaseUrl TEXT, apiKey TEXT, modelName TEXT, modelContextWindow INTEGER,
        imageModelEnabled INTEGER, imageModelName TEXT, imageModelSize TEXT, imageModelProtocol TEXT, imageApiBaseUrl TEXT, imageApiKey TEXT, tavilyApiKey TEXT);
      CREATE TABLE "Space" (id TEXT PRIMARY KEY, userId TEXT);
      CREATE TABLE "SpaceMember" (spaceId TEXT, agentId TEXT, roleName TEXT, modelName TEXT, apiBaseUrl TEXT, apiKey TEXT, sortOrder INTEGER);
      INSERT INTO "User" (id, customModelEnabled, apiBaseUrl, apiKey, modelName) VALUES ('alice', 1, 'https://global.test/v1', 'global-secret', 'global-a');
      INSERT INTO "User" (id) VALUES ('bob');
      INSERT INTO "Space" VALUES ('s1', 'alice');
      INSERT INTO "SpaceMember" (spaceId, agentId, sortOrder) VALUES ('s1', 'crypto-chart-master', 0), ('s1', 'ordinary', 1);
    `);
    db.exec(await readFile(new URL('../prisma/migrations/20261020120000_add_agent_model_settings/migration.sql', import.meta.url), 'utf8'));
    db.prepare('INSERT INTO "AgentModelSetting" (id, userId, agentId, modelName, apiBaseUrl, apiKey, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('a', 'alice', 'crypto-chart-master', role.modelName, role.apiBaseUrl, role.apiKey, '2026-10-20');
    db.prepare('INSERT INTO "AgentModelSetting" (id, userId, agentId, modelName, updatedAt) VALUES (?, ?, ?, ?, ?)')
      .run('b', 'bob', 'crypto-chart-master', 'bob-private-model', '2026-10-20');
    const context = { db, fakeMode: false, process: { env: {} }, resolveAgentModelConfig,
      builtInAgents: new Map(['crypto-chart-master', 'ordinary'].map(id => [id, { id, name: id, agentType: 'BASIC' }])) };
    vm.runInNewContext(source.slice(start, end) + 'return { agents, model: defaultModel }; }\nthis.load = loadRunContext;', context);
    const run = { spaceId: 's1', userId: 'alice' };
    const inherited = context.load(run);
    assert.equal(inherited.agents[0].model.name, 'role-b');
    assert.equal(inherited.agents[0].model.apiKey, 'role-secret');
    assert.equal(inherited.agents[1].model, null);
    assert.equal(inherited.model.name, 'global-a');
    db.prepare('UPDATE "SpaceMember" SET modelName = ? WHERE agentId = ?').run('space-c', 'crypto-chart-master');
    assert.equal(context.load(run).agents[0].model.name, 'space-c');
    assert.equal(db.prepare('SELECT modelName FROM "AgentModelSetting" WHERE userId = ?').get('alice').modelName, 'role-b');
    db.prepare('UPDATE "SpaceMember" SET modelName = NULL WHERE agentId = ?').run('crypto-chart-master');
    db.prepare('UPDATE "AgentModelSetting" SET modelName = ? WHERE userId = ?').run('role-d', 'alice');
    assert.equal(context.load(run).agents[0].model.name, 'role-d');
  } finally { db.close(); }
});
