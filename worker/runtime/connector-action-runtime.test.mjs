import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { encryptConnectorCredential } from '../../lib/connectors/credentials.mjs';
import { createConnectorActionRuntime } from './connector-action-runtime.mjs';

const secret = 'test-only-secret-that-is-longer-than-32-characters';

test('token cache writes to the connector id and refuses results for a replaced AppID', async () => {
  for (const replaceAppId of [false, true]) {
    const db = database();
    try {
      insertBase(db, {});
      db.prepare(`UPDATE "SpaceConnectorExecution" SET "operation" = 'WECHAT_VALIDATE_CONNECTION'`).run();
      const runtime = createConnectorActionRuntime({
        db, projectRoot: '/tmp', connectorSecret: secret,
        connectorFactory: ({ tokenCache }) => ({ validateConnection: async () => {
          if (replaceAppId) db.prepare(`UPDATE "SpaceConnector" SET "publicConfig" = ?, "status" = 'CONFIGURED'`).run(JSON.stringify({ appId: 'wx-new-app' }));
          await tokenCache.set({ token: 'test-access-token', expiresAt: Date.now() + 7200000 });
          return { validated: true };
        } }),
      });
      await runtime.processConnectorExecution(runtime.claimNextConnectorExecution());
      const connector = db.prepare('SELECT * FROM "SpaceConnector"').get();
      if (replaceAppId) { assert.equal(connector.accessTokenCiphertext, null); assert.equal(connector.status, 'CONFIGURED'); }
      else { assert.ok(connector.accessTokenCiphertext); assert.ok(!connector.accessTokenCiphertext.includes('test-access-token')); }
    } finally { db.close(); }
  }
});

test('only permission errors record unavailable publication and stale credentials cannot update new config', async () => {
  for (const scenario of ['permission', 'quota', 'changed']) {
    const db = database();
    try {
      insertBase(db, { mediaId: 'draft-1' });
      db.prepare(`UPDATE "SpaceConnectorExecution" SET "operation" = 'WECHAT_PUBLISH'`).run();
      const runtime = createConnectorActionRuntime({
        db, projectRoot: '/tmp', connectorSecret: secret,
        connectorFactory: () => ({ publish: async () => {
          if (scenario === 'changed') db.prepare(`UPDATE "SpaceConnector" SET "publicConfig" = ?, "credentialCiphertext" = ?, "status" = 'CONFIGURED'`).run(JSON.stringify({ appId: 'new-app' }), 'new-encrypted-secret');
          throw Object.assign(new Error('mock provider failure'), { providerCode: scenario === 'quota' ? 45009 : 48001 });
        } }),
      });
      await runtime.processConnectorExecution(runtime.claimNextConnectorExecution());
      const connector = db.prepare('SELECT * FROM "SpaceConnector"').get();
      const config = JSON.parse(connector.publicConfig);
      if (scenario === 'permission') assert.equal(config.interfacePermissions.publish.status, 'unavailable');
      else assert.equal(config.interfacePermissions, undefined);
      if (scenario === 'changed') { assert.equal(config.appId, 'new-app'); assert.equal(connector.status, 'CONFIGURED'); }
    } finally { db.close(); }
  }
});

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "Space" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL);
    CREATE TABLE "SpaceMessage" ("id" TEXT PRIMARY KEY, "spaceId" TEXT, "role" TEXT, "speakerAgentId" TEXT, "content" TEXT, "attachments" JSONB, "sourceKey" TEXT UNIQUE, "createdAt" DATETIME);
    CREATE TABLE "SpaceConnector" ("id" TEXT PRIMARY KEY, "spaceId" TEXT, "provider" TEXT, "enabled" BOOLEAN, "status" TEXT, "publicConfig" JSONB, "credentialCiphertext" TEXT, "accessTokenCiphertext" TEXT, "accessTokenExpiresAt" DATETIME, "lastCheckedAt" DATETIME, "lastError" TEXT, "updatedAt" DATETIME);
    CREATE TABLE "SpaceActionRequest" ("id" TEXT PRIMARY KEY, "spaceId" TEXT, "workId" TEXT, "kind" TEXT, "riskLevel" TEXT, "title" TEXT, "status" TEXT, "payload" JSONB, "result" JSONB, "error" TEXT, "idempotencyKey" TEXT UNIQUE, "requestedAt" DATETIME, "decidedAt" DATETIME, "completedAt" DATETIME, "createdAt" DATETIME, "updatedAt" DATETIME);
    CREATE TABLE "SpaceConnectorExecution" ("id" TEXT PRIMARY KEY, "connectorId" TEXT, "actionRequestId" TEXT UNIQUE, "operation" TEXT, "status" TEXT, "requestSummary" JSONB, "responseSummary" JSONB, "externalId" TEXT, "externalUrl" TEXT, "error" TEXT, "nextPollAt" DATETIME, "pollCount" INTEGER DEFAULT 0, "startedAt" DATETIME, "completedAt" DATETIME, "createdAt" DATETIME, "updatedAt" DATETIME);
  `);
  return db;
}

function insertBase(db, payload, status = 'QUEUED') {
  const timestamp = '2026-09-09T00:00:00.000Z';
  db.prepare('INSERT INTO "Space" VALUES (?, ?)').run('space-1', 'user-1');
  db.prepare('INSERT INTO "SpaceConnector" VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)').run(
    'connector-1', 'space-1', 'WECHAT_OFFICIAL_ACCOUNT', 1, 'CONFIGURED', JSON.stringify({ appId: 'wx-app' }),
    encryptConnectorCredential({ appSecret: 'app-secret' }, { spaceId: 'space-1', provider: 'WECHAT_OFFICIAL_ACCOUNT' }, secret), timestamp
  );
  db.prepare('INSERT INTO "SpaceActionRequest" VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, ?, ?)').run(
    'action-1', 'space-1', 'work-1', 'WECHAT_CREATE_DRAFT', 'HIGH', '创建微信草稿', 'APPROVED', JSON.stringify(payload), 'wechat-draft:1', timestamp, timestamp, timestamp, timestamp
  );
  db.prepare('INSERT INTO "SpaceConnectorExecution" VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, ?, ?)').run(
    'execution-1', 'connector-1', 'action-1', 'WECHAT_CREATE_DRAFT', status, timestamp, timestamp
  );
}

test('worker creates a draft from the approved immutable snapshot and requests publication separately', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-connector-'));
  const db = database();
  try {
    const directory = path.join(projectRoot, 'data', 'spaces', 'user-1', 'space-1', 'workspace');
    await mkdir(directory, { recursive: true });
    const cover = Buffer.from('cover-bytes');
    await writeFile(path.join(directory, 'cover.png'), cover);
    insertBase(db, { article: {
      title: '测试文章', html: '<p>正文</p>', coverFileId: 'cover-1',
      assets: [{ fileId: 'cover-1', fileName: 'cover.png', relativePath: 'workspace/cover.png', mimeType: 'image/png', size: cover.length, sha256: createHash('sha256').update(cover).digest('hex') }],
    } });
    const calls = [];
    const memories = [];
    const runtime = createConnectorActionRuntime({
      db, projectRoot, connectorSecret: secret,
      now: () => '2026-09-09T01:00:00.000Z',
      persistSpaceMemory: (...args) => memories.push(args),
      connectorFactory: () => ({
        uploadImage: async (input) => { calls.push(['upload', input.permanent]); return { mediaId: 'cover-media' }; },
        createDraft: async (articles) => { calls.push(['draft', articles[0].title]); return { mediaId: 'draft-media' }; },
      }),
    });
    const execution = runtime.claimNextConnectorExecution();
    assert.equal(execution.id, 'execution-1');
    await runtime.processConnectorExecution(execution);
    assert.deepEqual(calls, [['upload', true], ['draft', '测试文章']]);
    assert.equal(JSON.parse(db.prepare('SELECT "publicConfig" FROM "SpaceConnector"').get().publicConfig).interfacePermissions.draft.status, 'available');
    assert.match(memories[0][1][0].summary, /已创建微信草稿/);
    assert.equal(db.prepare('SELECT "status", "externalId" FROM "SpaceConnectorExecution" WHERE "id" = ?').get('execution-1').status, 'COMPLETED');
    const publish = db.prepare(`SELECT "kind", "status", "riskLevel" FROM "SpaceActionRequest" WHERE "kind" = 'WECHAT_PUBLISH'`).get();
    assert.deepEqual(publish, { kind: 'WECHAT_PUBLISH', status: 'PENDING', riskLevel: 'HIGH' });
    const publishAction = db.prepare(`SELECT * FROM "SpaceActionRequest" WHERE "kind" = 'WECHAT_PUBLISH'`).get();
    db.prepare(`UPDATE "SpaceActionRequest" SET "status" = 'APPROVED' WHERE "id" = ?`).run(publishAction.id);
    db.prepare(`INSERT INTO "SpaceConnectorExecution" ("id", "connectorId", "actionRequestId", "operation", "status", "createdAt", "updatedAt") VALUES (?, ?, ?, 'WECHAT_PUBLISH', 'QUEUED', ?, ?)`).run(
      'execution-2', 'connector-1', publishAction.id, '2026-09-09T01:30:00.000Z', '2026-09-09T01:30:00.000Z'
    );
    let currentTime = '2026-09-09T02:00:00.000Z';
    let statusChecks = 0;
    const publishRuntime = createConnectorActionRuntime({
      db, projectRoot, connectorSecret: secret,
      now: () => currentTime,
      persistSpaceMemory: (...args) => memories.push(args),
      connectorFactory: () => ({
        publish: async (mediaId) => ({ publishId: `publish-${mediaId}` }),
        publicationStatus: async () => ++statusChecks === 1
          ? { status: 1, articleId: null, urls: [], url: null, failIndex: null }
          : { status: 0, articleId: 'article-1', urls: ['https://mp.weixin.qq.com/s/test'], url: 'https://mp.weixin.qq.com/s/test', failIndex: null },
      }),
    });
    await publishRuntime.processConnectorExecution(publishRuntime.claimNextConnectorExecution());
    assert.equal(db.prepare(`SELECT "status" FROM "SpaceConnectorExecution" WHERE "id" = 'execution-2'`).get().status, 'WAITING_PROVIDER');
    assert.equal(JSON.parse(db.prepare('SELECT "publicConfig" FROM "SpaceConnector"').get().publicConfig).interfacePermissions.publish.status, 'available');
    assert.equal(db.prepare(`SELECT "status" FROM "SpaceActionRequest" WHERE "id" = ?`).get(publishAction.id).status, 'APPROVED');
    currentTime = '2026-09-09T02:01:00.000Z';
    await publishRuntime.processConnectorExecution(publishRuntime.claimNextConnectorExecution());
    assert.equal(db.prepare(`SELECT "status", "pollCount" FROM "SpaceConnectorExecution" WHERE "id" = 'execution-2'`).get().status, 'WAITING_PROVIDER');
    currentTime = '2026-09-09T02:02:01.000Z';
    await publishRuntime.processConnectorExecution(publishRuntime.claimNextConnectorExecution());
    assert.equal(db.prepare(`SELECT "status" FROM "SpaceActionRequest" WHERE "id" = ?`).get(publishAction.id).status, 'COMPLETED');
    assert.equal(db.prepare(`SELECT "externalId" FROM "SpaceConnectorExecution" WHERE "id" = 'execution-2'`).get().externalId, 'publish-draft-media');
    assert.equal(db.prepare(`SELECT "externalUrl" FROM "SpaceConnectorExecution" WHERE "id" = 'execution-2'`).get().externalUrl, 'https://mp.weixin.qq.com/s/test');
    assert.match(memories.at(-1)[1][0].summary, /已正式发布/);
  } finally {
    db.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('worker validates connector credentials without performing a publishing write', async () => {
  const db = database();
  try {
    insertBase(db, {});
    db.prepare(`UPDATE "SpaceActionRequest" SET "kind" = 'WECHAT_VALIDATE_CONNECTION', "riskLevel" = 'LOW', "title" = '验证微信公众号连接' WHERE "id" = 'action-1'`).run();
    db.prepare(`UPDATE "SpaceConnectorExecution" SET "operation" = 'WECHAT_VALIDATE_CONNECTION' WHERE "id" = 'execution-1'`).run();
    let validations = 0;
    const runtime = createConnectorActionRuntime({
      db, projectRoot: '/tmp', connectorSecret: secret,
      now: () => '2026-09-09T01:00:00.000Z',
      connectorFactory: () => ({ validateConnection: async () => { validations += 1; return { validated: true }; } }),
    });
    await runtime.processConnectorExecution(runtime.claimNextConnectorExecution());
    assert.equal(validations, 1);
    assert.deepEqual(db.prepare(`SELECT "status", "lastCheckedAt", "lastError" FROM "SpaceConnector" WHERE "id" = 'connector-1'`).get(), {
      status: 'READY', lastCheckedAt: '2026-09-09T01:00:00.000Z', lastError: null,
    });
    assert.equal(db.prepare(`SELECT "status" FROM "SpaceActionRequest" WHERE "id" = 'action-1'`).get().status, 'COMPLETED');
    assert.match(db.prepare(`SELECT "content" FROM "SpaceMessage" WHERE "sourceKey" = 'connector-action:action-1:WECHAT_VALIDATE_CONNECTION'`).get().content, /凭据验证通过.*权限仍以实际/);
    assert.equal(JSON.parse(db.prepare(`SELECT "publicConfig" FROM "SpaceConnector"`).get().publicConfig).interfacePermissions, undefined);
  } finally {
    db.close();
  }
});

test('approved cover changed without changing size fails before any external upload', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-frozen-cover-'));
  const db = database();
  try {
    const directory = path.join(projectRoot, 'data', 'spaces', 'user-1', 'space-1', 'workspace');
    await mkdir(directory, { recursive: true });
    const original = Buffer.from('original');
    await writeFile(path.join(directory, 'cover.png'), Buffer.from('modified'));
    insertBase(db, { article: { title: '冻结内容', html: '<p>正文</p>', coverFileId: 'cover-1', assets: [{ fileId: 'cover-1', fileName: 'cover.png', relativePath: 'workspace/cover.png', mimeType: 'image/png', size: original.length, sha256: createHash('sha256').update(original).digest('hex') }] } });
    let writes = 0;
    const runtime = createConnectorActionRuntime({ db, projectRoot, connectorSecret: secret, connectorFactory: () => ({ uploadImage: async () => { writes++; }, createDraft: async () => { writes++; } }) });
    await runtime.processConnectorExecution(runtime.claimNextConnectorExecution());
    assert.equal(writes, 0);
    assert.match(db.prepare('SELECT "error" FROM "SpaceConnectorExecution"').get().error, /审批后发生变化/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "SpaceActionRequest" WHERE "kind" = ?').get('WECHAT_PUBLISH').count, 0);
  } finally { db.close(); await rm(projectRoot, { recursive: true, force: true }); }
});

test('worker marks interrupted external actions uncertain instead of replaying them', () => {
  const db = database();
  try {
    insertBase(db, { article: {} }, 'RUNNING');
    const runtime = createConnectorActionRuntime({ db, projectRoot: '/tmp', connectorSecret: secret, now: () => '2026-09-09T02:00:00.000Z' });
    assert.equal(runtime.recoverInterruptedConnectorExecutions(), 1);
    assert.match(db.prepare('SELECT "status", "error" FROM "SpaceConnectorExecution"').get().error, /不会自动重试/);
    assert.equal(db.prepare('SELECT "status" FROM "SpaceActionRequest" WHERE "id" = ?').get('action-1').status, 'FAILED');
  } finally {
    db.close();
  }
});

test('worker safely resumes an interrupted read-only publication status check', () => {
  const db = database();
  try {
    insertBase(db, { mediaId: 'draft-1', title: '文章' }, 'RUNNING');
    db.prepare(`UPDATE "SpaceActionRequest" SET "kind" = 'WECHAT_PUBLISH' WHERE "id" = 'action-1'`).run();
    db.prepare(`UPDATE "SpaceConnectorExecution" SET "operation" = 'WECHAT_PUBLISH', "externalId" = 'publish-1' WHERE "id" = 'execution-1'`).run();
    const runtime = createConnectorActionRuntime({ db, projectRoot: '/tmp', connectorSecret: secret, now: () => '2026-09-09T03:00:00.000Z' });
    assert.equal(runtime.recoverInterruptedConnectorExecutions(), 1);
    assert.deepEqual(db.prepare(`SELECT "status", "nextPollAt" FROM "SpaceConnectorExecution" WHERE "id" = 'execution-1'`).get(), {
      status: 'WAITING_PROVIDER', nextPollAt: '2026-09-09T03:00:00.000Z',
    });
    assert.equal(db.prepare(`SELECT "status" FROM "SpaceActionRequest" WHERE "id" = 'action-1'`).get().status, 'APPROVED');
  } finally {
    db.close();
  }
});

test('worker safely requeues an interrupted connection validation', () => {
  const db = database();
  try {
    insertBase(db, {}, 'RUNNING');
    db.prepare(`UPDATE "SpaceActionRequest" SET "kind" = 'WECHAT_VALIDATE_CONNECTION', "riskLevel" = 'LOW' WHERE "id" = 'action-1'`).run();
    db.prepare(`UPDATE "SpaceConnectorExecution" SET "operation" = 'WECHAT_VALIDATE_CONNECTION' WHERE "id" = 'execution-1'`).run();
    const runtime = createConnectorActionRuntime({ db, projectRoot: '/tmp', connectorSecret: secret, now: () => '2026-09-09T03:00:00.000Z' });
    assert.equal(runtime.recoverInterruptedConnectorExecutions(), 1);
    assert.equal(db.prepare(`SELECT "status" FROM "SpaceConnectorExecution" WHERE "id" = 'execution-1'`).get().status, 'QUEUED');
    assert.equal(db.prepare(`SELECT "status" FROM "SpaceActionRequest" WHERE "id" = 'action-1'`).get().status, 'APPROVED');
  } finally {
    db.close();
  }
});
