import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import Database from 'better-sqlite3';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../../src/generated/prisma/client.ts';
import * as store from './store.mjs';
import { deliverPlatformNotifications } from '../../worker/runtime/platform-notifications.mjs';

const root = new URL('../../', import.meta.url);
const migrations = (await readdir(new URL('prisma/migrations/', root))).filter(name => /^\d/.test(name)).sort();
const sql = await Promise.all(migrations.map(name => readFile(new URL(`prisma/migrations/${name}/migration.sql`, root), 'utf8')));
async function fixture() {
  const folder = await mkdtemp(path.join(tmpdir(), 'almaren-inbox-'));
  const file = path.join(folder, 'test.db');
  const raw = new Database(file);
  for (const migration of sql) raw.exec(migration);
  const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) });
  await db.user.createMany({ data: ['owner', 'other'].map(id => ({ id, email: `${id}@test.local`, name: id, passwordHash: 'fixture' })) });
  return { db, raw, close: async () => { raw.close(); await db.$disconnect(); await rm(folder, { recursive: true, force: true }); } };
}

test('due reminders create one inbox entry without QQ, synchronize delivery, preserve read state and distinguish snoozed occurrences', async () => {
  const f = await fixture();
  try {
    const past = new Date(Date.now() - 60_000);
    const reminder = await f.db.assistantReminder.create({ data: { userId: 'owner', content: '提交报告', dueTime: past } });
    await f.db.assistantReminder.create({ data: { userId: 'owner', content: '尚未到期', dueTime: new Date(Date.now() + 86400_000) } });
    await store.syncNotifications(f.db, { userId: 'owner' });
    await store.syncNotifications(f.raw, { userId: 'owner' });
    let rows = await f.db.userNotification.findMany({ include: { deliveries: true } });
    assert.equal(rows.length, 1); assert.equal(rows[0].deliveries[0].status, 'NOT_CONFIGURED');
    await f.db.userNotification.update({ where: { id: rows[0].id }, data: { readAt: new Date() } });
    await f.db.platformNotification.create({ data: { userId: 'owner', baseUrl: 'https://qq.test', tokenCiphertext: 'encrypted', targetType: 'GROUP', targetId: '12345678' } });
    await deliverPlatformNotifications(f.raw, async () => ({ messageId: 'message-1' }));
    rows = await f.db.userNotification.findMany({ include: { deliveries: true } });
    assert.equal(rows.length, 1); assert.ok(rows[0].readAt); assert.equal(rows[0].deliveries[0].status, 'SENT');
    assert.equal((await f.db.assistantReminder.findUnique({ where: { id: reminder.id } })).status, 'PENDING');
    await f.db.assistantReminder.update({ where: { id: reminder.id }, data: { dueTime: new Date(past.getTime() + 1000), qqDeliveredAt: null, qqDeliveryAttempts: 0 } });
    await store.syncNotifications(f.db, { userId: 'owner' });
    assert.equal(await f.db.userNotification.count(), 2);
    assert.equal((await f.db.userNotificationDelivery.findFirst({ where: { notificationId: rows[0].id } })).status, 'SENT');
    await f.db.assistantReminder.delete({ where: { id: reminder.id } });
    assert.equal(await f.db.userNotification.count(), 2, 'archived messages survive removal of their source');
  } finally { await f.close(); }
});

test('recorded external events persist before sending, retain failure information and deduplicate channels', async () => {
  const f = await fixture();
  try {
    const input = { userId: 'owner', sourceKey: 'automation:one', kind: 'AUTOMATION', title: '自动化完成', content: '完整结果', sourceHref: '/spaces/example' };
    await assert.rejects(store.sendRecordedNotification(f.raw, null, input, async () => { throw Error('must not send'); }), /配置/);
    assert.equal((await f.db.userNotificationDelivery.findFirst()).status, 'NOT_CONFIGURED');
    await assert.rejects(store.sendRecordedNotification(f.raw, { enabled: true }, input, async () => { throw Error('private-token'); }), /发送失败/);
    assert.equal((await f.db.userNotificationDelivery.findFirst()).status, 'FAILED');
    assert.doesNotMatch((await f.db.userNotificationDelivery.findFirst()).error, /private-token/);
    let sent = 0;
    const sender = async () => { sent++; return { messageId: 'one' }; };
    await store.sendRecordedNotification(f.raw, { enabled: true }, input, sender);
    await store.sendRecordedNotification(f.raw, { enabled: true }, input, sender);
    assert.equal(sent, 1);
    await store.recordNotification(f.raw, { ...input, delivery: { channel: 'EMAIL', status: 'SENT', sentAt: new Date() } });
    assert.equal(await f.db.userNotification.count(), 1);
    assert.equal(await f.db.userNotificationDelivery.count(), 2);
  } finally { await f.close(); }
});

test('notification API scopes pagination, unread counts and read operations to the authenticated user', async () => {
  const f = await fixture();
  try {
    const source = await readFile(new URL('app/api/notifications/route.ts', root), 'utf8');
    const exports = {};
    const imports = {
      'next/server': { NextResponse: { json: (data, options) => Response.json(data, options) } },
      '@/app/api/_lib/db': { default: f.db }, '@/lib/notifications/store.mjs': store,
      '@/app/api/_lib/auth': { requireAuth(request) { const id = request.headers.get('x-user'); if (!id) throw Error('Unauthorized'); return id; } },
    };
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, URL, Date, require(name) { if (!(name in imports)) throw Error(name); return imports[name]; } });
    for (let i = 0; i < 21; i++) await store.recordNotification(f.db, { userId: 'owner', sourceKey: `fixture:${i}`, kind: 'SYSTEM', title: `消息 ${i}`, content: '内容' });
    const foreign = await store.recordNotification(f.db, { userId: 'other', sourceKey: 'private', kind: 'SYSTEM', title: '其他用户', content: '私人内容' });
    const get = url => exports.GET(new Request(`http://localhost/notifications${url}`, { headers: { 'x-user': 'owner' } }));
    const first = await (await get('')).json();
    assert.equal(first.notifications.length, 20); assert.equal(first.total, 21); assert.equal(first.unread, 21);
    const second = await (await get('?page=2')).json(); assert.equal(second.notifications.length, 1);
    const patch = body => exports.PATCH(new Request('http://localhost/notifications', { method: 'PATCH', headers: { 'x-user': 'owner' }, body: JSON.stringify(body) }));
    assert.equal((await (await patch({ action: 'read', id: foreign })).json()).changed, 0);
    await patch({ action: 'read', id: first.notifications[0].id });
    assert.equal((await (await get('?filter=UNREAD')).json()).unread, 20);
    await patch({ action: 'read-all' });
    assert.equal((await (await get('?filter=UNREAD')).json()).total, 0);
    assert.equal((await f.db.userNotification.findUnique({ where: { id: foreign } })).readAt, null);
    assert.equal((await exports.GET(new Request('http://localhost/notifications'))).status, 401);
    assert.equal((await get('?page=0')).status, 400);
  } finally { await f.close(); }
});

test('completed follow-up reports appear without any QQ setup and share one inbox item with their later delivery record', async () => {
  const f = await fixture();
  try {
    const now = new Date(Date.now() - 1000);
    await f.db.space.create({ data: { id: 'space', userId: 'owner', name: '研究空间' } });
    await f.db.spaceFollowUp.create({ data: { id: 'check', spaceId: 'space', agentId: 'analyst', title: '研究报告复核', prompt: '核验来源', context: '上下文', sourceKey: 'check', runAt: now, nextAttemptAt: now, status: 'COMPLETED', completedAt: now } });
    await f.db.spaceFollowUpReport.create({ data: { taskId: 'check', summary: '核验完成', content: '完整研究复核结果' } });
    await store.syncNotifications(f.db, { userId: 'owner' });
    let notification = await f.db.userNotification.findFirst({ include: { deliveries: true } });
    assert.equal(notification.kind, 'FOLLOW_UP'); assert.equal(notification.deliveries.length, 0);
    assert.equal(notification.sourceHref, '/spaces/space');
    const reminder = await f.db.assistantReminder.create({ data: { userId: 'owner', content: 'QQ 跟进摘要', dueTime: now, idempotencyKey: 'crypto-follow-up:space:check', qqDeliveredAt: now } });
    await f.db.spaceFollowUp.update({ where: { id: 'check' }, data: { qqReminderId: reminder.id } });
    await store.syncNotifications(f.raw, { userId: 'owner' });
    assert.equal(await f.db.userNotification.count(), 1);
    notification = await f.db.userNotification.findFirst({ include: { deliveries: true } });
    assert.equal(notification.content, '完整研究复核结果');
    assert.equal(notification.deliveries[0].status, 'SENT');
  } finally { await f.close(); }
});
