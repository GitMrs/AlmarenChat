import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { manageFeishuEvents, createFeishuEventManager, startEventBus } from './feishu-events.mjs';
import { encryptConnectorCredential } from './credentials.mjs';
import { connectorCredentialContext } from './personal-store.mjs';

process.env.SPACE_CONNECTOR_SECRET = 'feishu-events-test-secret-at-least-32-characters';
const server = { connectorId: 'connector', userId: 'alice', scope: 'agent', scopeId: 'lulu' };
function fixture(t) {
  const db = new Database(':memory:'); db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE User (id TEXT PRIMARY KEY); INSERT INTO User VALUES (\'alice\'),(\'bob\');');
  for (const migration of ['20261112100000_add_personal_connectors', '20261112180000_add_feishu_subscriptions']) db.exec(readFileSync(new URL(`../../prisma/migrations/${migration}/migration.sql`, import.meta.url), 'utf8'));
  const secret = encryptConnectorCredential({ appId: 'cli_test', appSecret: 'PRIVATE' }, connectorCredentialContext({ id: 'connector', userId: 'alice' }));
  db.prepare('INSERT INTO PersonalConnector (id,userId,toolId,name,url,catalogId,headersCiphertext,updatedAt) VALUES (?,?,?,?,?,?,?,?)').run('connector', 'alice', 'feishu-cli', '飞书', 'connector:feishu-cli', 'feishu-cli', secret, 'now');
  db.exec("INSERT INTO ConnectorBinding (id,connectorId,userId,scope,scopeId) VALUES ('binding','connector','alice','agent','lulu');");
  t.after(() => db.close());
  return db;
}
function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.stdin.once('finish', () => queueMicrotask(() => child.emit('close', 0)));
  child.kill = signal => { child.signal = signal; queueMicrotask(() => child.emit('close', 0)); return true; };
  return child;
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('event subscriptions are per binding and encrypted inboxes cannot cross users or scopes', t => {
  const db = fixture(t);
  const result = manageFeishuEvents(db, server, { action: 'start', eventKey: 'im.message.receive_v1', params: { chat_id: 'chat' } });
  assert.equal(result.subscriptions.length, 1);
  assert.throws(() => manageFeishuEvents(db, { ...server, userId: 'bob' }, { action: 'list' }), /关闭或删除/);
  assert.throws(() => manageFeishuEvents(db, { ...server, scopeId: 'other' }, { action: 'inbox' }), /关闭或删除/);
  assert.throws(() => manageFeishuEvents(db, server, { action: 'start', eventKey: 'invalid;command' }), /EventKey/);
  assert.throws(() => manageFeishuEvents(db, server, { action: 'start', eventKey: 'im.message.receive_v1', params: { bad: [] } }), /参数/);
});

test('worker shares a separate bus, observes ready marker, deduplicates events and stops on revocation', async t => {
  const db = fixture(t);
  manageFeishuEvents(db, server, { action: 'start', eventKey: 'im.message.receive_v1' });
  const children = [], commands = [], buses = [];
  const options = { prepare: async () => ({ dirs: { files: '/test' }, env: {} }), busFactory: async () => { const child = fakeChild(); buses.push(child); return child; }, spawn: argv => { commands.push(argv); const child = fakeChild(); children.push(child); return child; } };
  const manager = createFeishuEventManager(db, options);
  await manager.tick(); await flush(); await manager.tick(); await flush();
  assert.equal(children.length, 1);
  assert.equal(children[0].stdin.writableEnded, false);
  assert.equal(commands[0].includes('--timeout'), false);
  assert.equal(manageFeishuEvents(db, server).subscriptions[0].status, 'starting');
  children[0].stderr.write('[event] ready event_key=im.message.receive_v1\n');
  assert.equal(manageFeishuEvents(db, server).subscriptions[0].status, 'running');
  const firstId = manageFeishuEvents(db, server).subscriptions[0].id;
  manageFeishuEvents(db, server, { action: 'start', eventKey: 'task.task.updated_v1' });
  await manager.tick(); await flush();
  assert.equal(buses.length, 1); assert.equal(children.length, 2);
  const line = JSON.stringify({ header: { event_id: 'one' }, event: { content: 'private event' } }) + '\n';
  children[0].stdout.write(line); children[0].stdout.write(line);
  const inbox = manageFeishuEvents(db, server, { action: 'inbox' });
  assert.equal(inbox.events.length, 1); assert.equal(inbox.events[0].payload.event.content, 'private event');
  assert.doesNotMatch(db.prepare('SELECT payloadCiphertext FROM ConnectorInboxEvent').get().payloadCiphertext, /private event/);
  assert.equal(manageFeishuEvents(db, server, { action: 'inbox', after: inbox.events[0].id }).events.length, 0);
  const otherManager = createFeishuEventManager(db, options);
  await otherManager.tick(); assert.equal(children.length, 2);
  manageFeishuEvents(db, server, { action: 'stop', id: firstId });
  await manager.tick(); await flush(); await flush();
  assert.equal(children[0].stdin.writableEnded, true); assert.equal(children[1].stdin.writableEnded, false); assert.equal(buses[0].signal, undefined);
  db.exec('DELETE FROM ConnectorBinding');
  await manager.tick(); await flush(); await flush();
  assert.equal(children[0].stdin.writableEnded, true);
  assert.equal(db.prepare('SELECT status FROM ConnectorSubscription').get().status, 'stopped');
  assert.equal(buses[0].stdin.writableEnded, true);
  await manager.shutdown(); await otherManager.shutdown();
});

for (const reason of ['stop', 'revoke', 'replace', 'delete', 'logout']) {
  test(`the last Feishu consumer releases its bus after ${reason}`, async t => {
    const db = fixture(t);
    const id = manageFeishuEvents(db, server, { action: 'start', eventKey: 'im.message.receive_v1', identity: 'user' }).subscriptions[0].id;
    let bus, child;
    const manager = createFeishuEventManager(db, {
      prepare: async () => ({ dirs: { files: '/test' }, env: {} }),
      busFactory: async () => bus = fakeChild(), spawn: () => child = fakeChild(),
    });
    await manager.tick(); await flush();
    if (reason === 'stop') manageFeishuEvents(db, server, { action: 'stop', id });
    if (reason === 'revoke') db.exec('DELETE FROM ConnectorBinding');
    if (reason === 'replace') db.prepare('UPDATE PersonalConnector SET headersCiphertext = ?').run(encryptConnectorCredential({ appId: 'cli_new', appSecret: 'changed' }, connectorCredentialContext({ id: 'connector', userId: 'alice' })));
    if (reason === 'delete') db.exec('DELETE FROM PersonalConnector');
    if (reason === 'logout') db.exec("UPDATE ConnectorSubscription SET enabled = 0, status = 'stopping' WHERE identity = 'user'");
    await manager.tick(); await flush();
    assert.equal(child.stdin.writableEnded, true);
    assert.equal(bus.stdin.writableEnded, true);
    await manager.shutdown();
  });
}

test('a cancelled startup releases its bus without stopping another pending consumer', async t => {
  const db = fixture(t);
  const firstId = manageFeishuEvents(db, server, { action: 'start', eventKey: 'im.message.receive_v1' }).subscriptions[0].id;
  manageFeishuEvents(db, server, { action: 'start', eventKey: 'task.task.updated_v1' });
  let ready, bus;
  const pending = new Promise(resolve => { ready = resolve; });
  const children = [];
  const manager = createFeishuEventManager(db, {
    prepare: async () => ({ dirs: { files: '/test' }, env: {} }),
    busFactory: async () => { bus = fakeChild(); await pending; return bus; },
    spawn: () => { const child = fakeChild(); children.push(child); return child; },
  });
  await manager.tick(); await flush();
  manageFeishuEvents(db, server, { action: 'stop', id: firstId });
  ready(); await flush();
  assert.equal(children.length, 1);
  assert.equal(bus.stdin.writableEnded, false);
  db.exec('DELETE FROM ConnectorBinding');
  await manager.tick(); await flush();
  assert.equal(bus.stdin.writableEnded, true);
  await manager.shutdown();
});

test('startup failure after bus creation reclaims the unused bus', async t => {
  const db = fixture(t);
  const id = manageFeishuEvents(db, server, { action: 'start', eventKey: 'im.message.receive_v1' }).subscriptions[0].id;
  let bus;
  const manager = createFeishuEventManager(db, {
    prepare: async () => ({ dirs: { files: '/test' }, env: {} }),
    busFactory: async () => { bus = fakeChild(); manageFeishuEvents(db, server, { action: 'stop', id }); return bus; },
    spawn: () => { throw Error('cancelled startup must not launch a consumer'); },
  });
  await manager.tick(); await flush();
  assert.equal(bus.stdin.writableEnded, true);
  await manager.shutdown();
});

test('a replacement consumer waits for a closing bus to release its socket', async t => {
  const db = fixture(t);
  const id = manageFeishuEvents(db, server, { action: 'start', eventKey: 'im.message.receive_v1' }).subscriptions[0].id;
  const buses = [], children = [];
  const manager = createFeishuEventManager(db, {
    prepare: async () => ({ dirs: { files: '/test' }, env: {} }),
    busFactory: async () => {
      const bus = fakeChild();
      if (!buses.length) {
        bus.stdin.removeAllListeners('finish');
        bus.kill = signal => { bus.signal = signal; return true; };
      }
      buses.push(bus); return bus;
    },
    spawn: () => { const child = fakeChild(); children.push(child); return child; },
  });
  await manager.tick(); await flush();
  manageFeishuEvents(db, server, { action: 'stop', id });
  await manager.tick(); await flush();
  assert.equal(buses[0].signal, 'SIGTERM');
  manageFeishuEvents(db, server, { action: 'start', eventKey: 'task.task.updated_v1' });
  await manager.tick(); await flush();
  assert.equal(buses.length, 1); assert.equal(children.length, 1);
  buses[0].emit('close', 0);
  await flush();
  assert.equal(buses.length, 2); assert.equal(children.length, 2);
  await manager.shutdown();
});

test('restart recovers only expired leases and failing consumers expose errors with retry delay', async t => {
  const db = fixture(t);
  manageFeishuEvents(db, server, { action: 'start', eventKey: 'task.task.updated_v1' });
  let now = Date.now(); let count = 0; let child;
  db.prepare('UPDATE ConnectorSubscription SET leaseUntil = ?').run(now + 1000);
  const manager = createFeishuEventManager(db, { clock: () => now, busFactory: async () => fakeChild(), prepare: async () => ({ dirs: { files: '/test' }, env: {} }), spawn: () => { count++; child = fakeChild(); return child; } });
  await manager.tick(); await flush(); assert.equal(count, 0);
  now += 1001; await manager.tick(); await flush(); assert.equal(count, 1);
  child.emit('close', 3);
  const row = db.prepare('SELECT * FROM ConnectorSubscription').get();
  assert.equal(row.status, 'error'); assert.ok(row.leaseUntil > now);
  await manager.tick(); await flush(); assert.equal(count, 1);
  await manager.shutdown();
});

test('slow startup does not block ticks and changed credentials prevent the old consumer from starting', async t => {
  const db = fixture(t);
  manageFeishuEvents(db, server, { action: 'start', eventKey: 'im.message.receive_v1' });
  let release;
  let consumers = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const manager = createFeishuEventManager(db, {
    prepare: () => pending,
    busFactory: async () => fakeChild(),
    spawn: () => { consumers++; return fakeChild(); },
  });
  await manager.tick();
  await manager.tick();
  assert.equal(consumers, 0);
  db.prepare('UPDATE PersonalConnector SET headersCiphertext = ?').run('replaced-credentials');
  release({ dirs: { files: '/test' }, env: {} });
  await flush();
  assert.equal(consumers, 0);
  assert.match(db.prepare('SELECT lastError FROM ConnectorSubscription').get().lastError, /凭据已更换/);
  await manager.shutdown();
});

test('Windows event startup probes the official named pipe without opening Unix directories', { skip: process.platform !== 'win32' }, async () => {
  const appId = `cli_test_${randomUUID().replaceAll('-', '')}`;
  const listener = createServer(socket => socket.end());
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(`\\\\.\\pipe\\lark-cli-${appId}`, resolve); });
  try {
    const child = fakeChild();
    const result = await startEventBus({ headers: { appId } }, { dirs: { config: 'not-a-real-config-directory', files: 'test' }, env: {} }, argv => {
      assert.deepEqual(argv, ['event', '_bus']); return child;
    });
    assert.equal(result, child);
    child.stdin.end();
  } finally { await new Promise(resolve => listener.close(resolve)); }
});
