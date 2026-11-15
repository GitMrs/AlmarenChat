import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import Database from 'better-sqlite3';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../../src/generated/prisma/client.ts';
import * as policy from './follow-up-policy.mjs';
import * as analysis from '../workspace/crypto/okx-analysis.mjs';
import * as workPaths from './space-work-paths.mjs';
import * as toolLoop from '../agents/runtime/tool-loop.mjs';
import * as notificationPolicy from './follow-up-notification-policy.mjs';
import * as qqDelivery from '../../worker/runtime/follow-up-qq-notifications.mjs';
import { cancelUnavailableFollowUpQQNotifications, canDeliverFollowUpQQNotification, claimDueQQReminder, formatQQReminderMessage, selectDueQQReminders, stopExhaustedMarketQQNotifications } from '../../worker/runtime/follow-up-qq-notifications.mjs';
import { qqReminderRetryDelayMs, sqliteDate } from '../qq-assistant/policy.mjs';

const root = new URL('../../', import.meta.url);
const migrations = (await readdir(new URL('prisma/migrations/', root))).filter(name => /^\d/.test(name)).sort();
const sql = await Promise.all(migrations.map(name => readFile(new URL(`prisma/migrations/${name}/migration.sql`, root), 'utf8')));
async function load(file, imports) {
  const source = await readFile(new URL(file, root), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, console, Date, URL, AbortSignal, process: { env: {}, cwd: () => process.cwd() }, globalThis: {}, require(name) {
    if (name in imports) return imports[name];
    throw new Error(`Unexpected import ${name}`);
  } });
  return exports;
}

// 执行真实Worker投递循环，仅用假的QQ发送端验证次数，不连接QQ。
async function loadQQDeliveryLoop(db, binding, clock, sendWakeup) {
  const worker = await readFile(new URL('worker/qq-assistant.mjs', root), 'utf8');
  const source = worker.slice(worker.indexOf('async function deliverDueReminders()'), worker.indexOf('\nfunction writeJson'));
  const context = {
    db, secret: 'fixture-secret-with-at-least-32-characters', stopping: false, reminderLoopRunning: false, pollMs: 0,
    clients: new Map([[`personal:${binding.userId}`, { ...binding, kind: 'PERSONAL', ready: true, lastProactiveAt: 0, bot: { sendWakeup } }]]),
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [clock.now])); }
      static now() { return new Date(clock.now).getTime(); }
    },
    sqliteDate: value => sqliteDate(value || new Date(clock.now)), qqReminderRetryDelayMs,
    shortError: error => error.message, ...qqDelivery,
    MARKET_QQ_MAX_DELIVERY_ATTEMPTS: notificationPolicy.MARKET_QQ_MAX_DELIVERY_ATTEMPTS,
    isMarketQQNotification: notificationPolicy.isMarketQQNotification,
  };
  vm.runInNewContext(`${source}\nglobalThis.deliver = deliverDueReminders;`, context);
  return context.deliver;
}

async function fixture() {
  const folder = await mkdtemp(path.join(tmpdir(), 'almaren-follow-up-'));
  const file = path.join(folder, 'test.db');
  const sqlite = new Database(file);
  for (const migration of sql) sqlite.exec(migration);
  sqlite.close();
  const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) });
  await db.user.createMany({ data: [
    { id: 'owner', email: 'owner@test.local', name: 'Owner', passwordHash: 'fixture' },
    { id: 'other', email: 'other@test.local', name: 'Other', passwordHash: 'fixture' },
  ] });
  await db.space.createMany({ data: [
    { id: 'a', userId: 'owner', name: 'A', templateId: 'crypto-contract-trading' },
    { id: 'b', userId: 'owner', name: 'B', templateId: 'crypto-contract-trading', followUpEnabled: true },
    { id: 'other-space', userId: 'other', name: 'Other', templateId: 'crypto-contract-trading', followUpEnabled: true },
    { id: 'general', userId: 'owner', name: 'General', followUpEnabled: true },
    { id: 'pi', userId: 'owner', name: 'PI', runtimeType: 'PI_CODING', followUpEnabled: true },
  ] });
  await db.spaceMember.createMany({ data: ['a', 'b', 'other-space', 'general', 'pi'].map(spaceId => ({ spaceId, agentId: 'analyst' })) });
  const spaces = {
    getSpaceForUser: (spaceId, userId) => db.space.findFirst({ where: { id: spaceId, userId }, include: { members: true } }),
    SPACE_COORDINATOR: { id: 'space-coordinator' },
  };
  const tools = await load('lib/space/follow-up-tools.ts', {
    'node:crypto': { createHash: (await import('node:crypto')).createHash, randomUUID },
    '@/app/api/_lib/db': { default: db }, '@/app/api/_lib/spaces': spaces,
    './follow-up-policy.mjs': policy,
  });
  const notifications = await load('lib/space/follow-up-notifications.ts', {
    'node:crypto': { createHash }, '@/app/api/_lib/db': { default: db }, './follow-up-notification-policy.mjs': notificationPolicy,
  });
  const work = await load('lib/space/follow-up-work.ts', {
    './space-work-paths.mjs': workPaths,
    '../agents/runtime/runtime-tools.mjs': { workspaceToolSchemas: ['read_file', 'list_files', 'write_file'].map(name => ({ type: 'function', function: { name } })),
      executeWorkspaceTool: async () => { throw Error('Unexpected file query'); } },
  });
  const serviceImports = {
    'node:crypto': { randomUUID }, '@/app/api/_lib/db': { default: db }, '@/app/api/_lib/spaces': spaces,
    '../web/auto-web': {}, '../capabilities/registry.mjs': {}, '../agents/runtime/tool-loop.mjs': {},
    '../agents/memory/current-time-context.mjs': {}, '../chat/conversation-grounding.mjs': {},
    './space-message-runtime': {}, '../core/scheduler.mjs': {}, './follow-up-policy.mjs': policy,
    './follow-up-domains': {}, './follow-up-work': work,
    './follow-up-notifications': notifications, './follow-up-notification-policy.mjs': notificationPolicy,
  };
  const service = await load('lib/space/follow-up-service.ts', serviceImports);
  const route = await load('app/api/spaces/[spaceId]/follow-ups/route.ts', {
    'next/server': { NextResponse: { json: (data, options) => Response.json(data, options) } },
    '@/app/api/_lib/db': { default: db }, '@/app/api/_lib/spaces': spaces,
    '@/lib/space/follow-up-notifications': notifications,
    '@/lib/space/follow-up-policy.mjs': policy,
    '@/app/api/_lib/auth': { requireAuth(request) { const user = request.headers.get('x-test-user'); if (!user) throw Error('Unauthorized'); return user; } },
  });
  const client = (spaceId = 'a', userId = 'owner', agentId = 'analyst', userMessage, workId) => tools.createSpaceFollowUpTools({
    userId, spaceId, agentId, sourceMessageId: 'source-turn', networkAllowed: true,
    history: [{ role: 'user', content: 'BTC 21点再看，比较67487压力位' }],
    userMessage, workId,
  });
  const patch = (spaceId, body, userId = 'owner') => route.PATCH(new Request('http://localhost/follow-ups', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-test-user': userId }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ spaceId }) });
  const due = new Date(Date.now() + 60_000);
  const bindQQ = async (userId = 'owner') => {
    const conversation = await db.conversation.create({ data: { userId } });
    return db.assistantQQBinding.create({ data: {
      userId, conversationId: conversation.id, appId: `fixture-${userId}`, appSecretCiphertext: 'fixture',
      enabled: true, qqOpenId: `fixture-recipient-${userId}`, status: 'READY',
    } });
  };
  const schedule = (spaceId = 'a') => client(spaceId).execute('schedule_space_follow_up', {
    title: 'BTC 收线复查', prompt: '查询BTC最新行情，对比67487压力位是否收复', runAt: due.toISOString(),
  });
  return { db, file, bindQQ, client, service, serviceImports, route, patch, due, schedule, close: async () => { await db.$disconnect(); await rm(folder, { recursive: true, force: true }); } };
}

test('follow-up times require explicit zones, future deadlines and a bounded horizon', () => {
  const now = new Date('2026-11-14T12:41:00Z');
  const input = { title: 'BTC', prompt: '复查BTC', runAt: '2026-11-14T21:00:00+08:00' };
  assert.equal(policy.normalizeFollowUp(input, now).runAt.toISOString(), '2026-11-14T13:00:00.000Z');
  for (const runAt of ['2026-11-14T21:00:00', '2026-11-14T12:00:00Z', 'bad', '2026-12-14T13:00:00Z']) {
    assert.throws(() => policy.normalizeFollowUp({ ...input, runAt }, now));
  }
});

test('artifact follow-up intent recognizes future checks while keeping immediate review and feature questions temporary', () => {
  for (const text of ['半小时后再核验这份报告', '明天复核来源', '后续检查论文的更新', '到时核对这份成果']) {
    assert.equal(policy.isExplicitFollowUpRequest(text), true, text);
  }
  for (const text of ['帮我核验这份报告', '检查一下论文', '如何使用自动检查功能', '不用后续检查了']) {
    assert.equal(policy.isExplicitFollowUpRequest(text), false, text);
  }
});

test('generalization migration preserves saved contract jobs, leases, settings and previous reports', () => {
  const db = new Database(':memory:');
  try {
    for (const migration of sql.slice(0, -1)) db.exec(migration);
    db.exec(`
      INSERT INTO "User" (id,email,name,passwordHash,updatedAt) VALUES ('migration-user','migration@test.local','Migration','fixture',CURRENT_TIMESTAMP);
      INSERT INTO "Space" (id,userId,name,templateId,cryptoAutonomyEnabled,cryptoFollowUpQQEnabled,cryptoFollowUpMaxContinuations,updatedAt)
        VALUES ('migration-space','migration-user','Contract','crypto-contract-trading',1,1,6,CURRENT_TIMESTAMP);
      INSERT INTO "SpaceFollowUp" (id,spaceId,agentId,title,prompt,context,sourceKey,runAt,nextAttemptAt,status,completedAt,updatedAt)
        VALUES ('previous-report','migration-space','analyst','BTC复查','核验收线','旧证据','old-root',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'COMPLETED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
      INSERT INTO "SpaceFollowUp" (id,spaceId,agentId,title,prompt,context,sourceKey,runAt,nextAttemptAt,status,chainDepth,maxChainDepth,parentId,attempts,claimToken,leaseUntil,updatedAt)
        VALUES ('saved-check','migration-space','analyst','BTC续查','核验下一根收线','旧证据','old-child',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'RUNNING',1,6,'previous-report',2,'old-claim',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
      INSERT INTO "SpaceMessage" (id,spaceId,role,content,sourceKey) VALUES ('old-message','migration-space','assistant','已有完整复查报告','space-follow-up:previous-report');
    `);
    const before = db.prepare('SELECT * FROM "SpaceFollowUp" WHERE id = ?').get('saved-check');
    db.exec(sql.at(-1));
    const after = db.prepare('SELECT * FROM "SpaceFollowUp" WHERE id = ?').get('saved-check');
    for (const key of Object.keys(before)) assert.equal(after[key], before[key], key);
    assert.equal(after.domain, 'CRYPTO');
    assert.equal(after.workId, null);
    assert.equal(db.prepare('SELECT content FROM "SpaceFollowUpReport" WHERE taskId = ?').get('previous-report').content, '已有完整复查报告');
    assert.equal(db.prepare('SELECT cryptoFollowUpMaxContinuations FROM "Space"').get().cryptoFollowUpMaxContinuations, 6);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('general-space follow-ups preserve the chosen work and reject cross-space targets and implicit scheduling', async () => {
  const f = await fixture();
  try {
    await f.db.spaceWork.createMany({ data: [
      { id: 'report-a', spaceId: 'general', title: '研究报告', kind: 'DOCUMENT' },
      { id: 'report-b', spaceId: 'general', title: '第二份报告', kind: 'DOCUMENT' },
      { id: 'foreign-report', spaceId: 'other-space', title: '他人报告', kind: 'DOCUMENT' },
    ] });
    const args = { title: '报告后续核验', prompt: '复核报告论据是否更新', runAt: f.due.toISOString() };
    const scoped = f.client('general', 'owner', 'analyst', '后续帮我跟进这份报告', 'report-a');
    const first = await scoped.execute('schedule_space_follow_up', args);
    assert.equal(first.ok, true); assert.equal(first.workId, 'report-a');
    const saved = await f.db.spaceFollowUp.findUnique({ where: { id: first.id } });
    assert.equal(saved.domain, 'GENERAL'); assert.equal(saved.workTitle, '研究报告');
    assert.equal(saved.sourceMessageId, 'source-turn'); assert.match(saved.context, /安排时的成果状态/);
    assert.equal((await scoped.execute('schedule_space_follow_up', { ...args, workId: 'report-b' })).ok, false);
    const unscoped = f.client('general', 'owner', 'analyst', '后续继续跟进一下');
    assert.equal((await unscoped.execute('schedule_space_follow_up', { ...args, workId: 'foreign-report' })).ok, false);
    const dialogue = await unscoped.execute('schedule_space_follow_up', args);
    assert.equal(dialogue.ok, true); assert.equal(dialogue.workId, null);
    const temporary = f.client('general', 'owner', 'analyst', '看看这份报告', 'report-a');
    assert.equal((await temporary.execute('schedule_space_follow_up', args)).ok, false);
    const get = query => f.route.GET(new Request(`http://localhost/follow-ups?${query}`, { headers: { 'x-test-user': 'owner' } }), { params: Promise.resolve({ spaceId: 'general' }) });
    const history = await (await get('view=history&workId=report-a')).json();
    assert.equal(history.total, 1); assert.equal(history.tasks[0].id, first.id);
    assert.equal((await get('view=history&workId=foreign-report')).status, 404);
    assert.equal((await get(`taskId=${dialogue.id}&workId=report-a`)).status, 404);
    assert.equal(await f.db.spaceFile.count(), 0, 'scheduling never manufactures an artifact');
  } finally { await f.close(); }
});

test('general work reports read current evidence, keep full history and publish a brief reply with a scoped continuation and notification', async () => {
  const f = await fixture();
  try {
    await f.db.spaceWork.create({ data: { id: 'research', spaceId: 'general', title: 'BTC研究资料', kind: 'DOCUMENT', objective: '核验资料初稿' } });
    await f.db.spaceFile.create({ data: { id: 'research-file', spaceId: 'general', workId: 'research', fileName: 'report.md', relativePath: 'workspace/works/research/output/report.md' } });
    const scheduled = await f.client('general', 'owner', 'analyst', '后续继续跟进这份报告', 'research').execute('schedule_space_follow_up', {
      title: '资料更新核验', prompt: '读取研究成果，比较资料来源是否更新', runAt: f.due.toISOString(),
    });
    await f.db.spaceWork.update({ where: { id: 'research' }, data: { objective: '核验修订版的新来源' } });
    await f.bindQQ(); await f.patch('general', { qqEnabled: true });
    let reads = 0, models = 0;
    const domain = await load('lib/space/follow-up-domains.ts', {
      '../workspace/crypto/okx-analysis.mjs': analysis,
      '../workspace/crypto/market-tools': { queryCryptoMarket: async () => { throw new Error('general work must not fetch contract data'); } },
    });
    const work = await load('lib/space/follow-up-work.ts', {
      './space-work-paths.mjs': workPaths,
      '../agents/runtime/runtime-tools.mjs': { workspaceToolSchemas: ['read_file', 'list_files', 'write_file', 'check_files'].map(name => ({ type: 'function', function: { name } })),
        executeWorkspaceTool: async (options, name, args) => {
          reads++; assert.equal(options.spaceId, 'general'); assert.equal(options.workId, 'research');
          assert.equal(options.userId, 'owner'); assert.equal(name, 'read_file'); assert.equal(args.path, 'output/report.md');
          return { content: '已核验：修订版新增了官方来源与发布日期。', offset: 0, totalChars: 24 };
        } },
    });
    const fullBody = '资料已更新，新增来源已核验，可以结束本项来源检查。\n\n完整证据：' + '已读取的来源内容与日期。'.repeat(70);
    const generate = await load('lib/space/follow-up-service.ts', { ...f.serviceImports,
      './follow-up-domains': domain, './follow-up-work': work,
      './space-message-runtime': { prepareSpaceMessageRuntime: async () => ({ promptContext: '', agentPolicy: () => '' }) },
      '../agents/memory/current-time-context.mjs': { currentTimeContext: () => 'current time' },
      '../agents/runtime/tool-loop.mjs': toolLoop,
      '../capabilities/registry.mjs': { getReadOnlyExternalCapabilityIds: () => [] },
      '../web/auto-web': { createChatWebTools: () => ({ tools: [], guidance: '', footer: () => '', attachments: () => [] }) },
      '@/app/api/_lib/spaces': { ...f.serviceImports['@/app/api/_lib/spaces'],
        resolveAgent: async () => ({ id: 'analyst', name: '研究员', systemPrompt: '核验资料' }),
        resolveSpaceMemberModelConfig: async () => ({ model: 'fixture', client: { chat: { completions: { async *create(body) {
          models++;
          assert.match(body.messages[0].content, /核验修订版的新来源/);
          assert.doesNotMatch(body.messages[0].content, /进入候选方案评估|OI时效|必须.*收线/);
          assert.ok(body.tools.every(tool => !['write_file', 'check_files', 'request_sentinel_qq_notification'].includes(tool.function.name)));
          if (models === 1) { yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'read-current', type: 'function', function: { name: 'read_file', arguments: '{"path":"output/report.md"}' } }] } }] }; return; }
          if (models === 2) {
            assert.equal(reads, 1); assert.match(JSON.stringify(body.messages), /官方来源与发布日期/);
            yield { choices: [{ delta: { tool_calls: [
              { index: 0, id: 'continue-research', type: 'function', function: { name: 'schedule_next_space_follow_up', arguments: JSON.stringify({ title: '下一次资料核验', prompt: '比较修订版的来源证据和待发布资料，结束条件为目标来源全部核验', runAt: new Date(f.due.getTime() + 30 * 60_000).toISOString(), reason: '核验剩余资料来源' }) } },
              { index: 1, id: 'notify-research', type: 'function', function: { name: 'request_follow_up_qq_notification', arguments: JSON.stringify({ category: 'IMPORTANT_CHANGE', eventKey: 'RESEARCH:SOURCES:UPDATED', title: '研究资料有重要更新', summary: '本次读取修订版后发现官方来源已补齐，请查看报告。', reason: '关键来源核验结果更新' }) } },
            ] } }] }; return;
          }
          yield { choices: [{ delta: { content: fullBody } }] };
        } } } } }),
      },
    });
    await f.service.runSpaceFollowUpTick({ db: f.db, now: f.due, generate: generate.generateSpaceFollowUp });
    assert.equal(models, 3);
    const report = await f.db.spaceFollowUpReport.findUnique({ where: { taskId: scheduled.id } });
    assert.match(report.content, /完整证据/); assert.match(report.content, /下次自主跟进/);
    assert.equal(report.summary, fullBody.split('\n\n')[0]);
    const message = await f.db.spaceMessage.findFirst({ where: { spaceId: 'general' } });
    assert.match(message.content, /资料已更新/); assert.doesNotMatch(message.content, /完整证据/);
    assert.match(message.content, /BTC研究资料.*跟进记录/);
    const child = await f.db.spaceFollowUp.findUnique({ where: { parentId: scheduled.id } });
    assert.equal(child.workId, 'research'); assert.equal(child.domain, 'GENERAL'); assert.equal(child.sourceMessageId, 'source-turn');
    assert.equal(await f.db.spaceFile.count(), 1, 'each report is a record, not a new artifact file');
    const reminder = await f.db.assistantReminder.findFirst();
    assert.match(reminder.content, /自主跟进·重要变化速报/); assert.doesNotMatch(reminder.content, /鹰眼/);
    const raw = new Database(f.file);
    try {
      const now = new Date(f.due.getTime() + 1000);
      const due = selectDueQQReminders(raw, ['owner'], now);
      assert.equal(due.length, 1); assert.equal(canDeliverFollowUpQQNotification(raw, due[0], now), true);
    } finally { raw.close(); }
    const detailResponse = await f.route.GET(new Request(`http://localhost/follow-ups?taskId=${scheduled.id}`, { headers: { 'x-test-user': 'owner' } }), { params: Promise.resolve({ spaceId: 'general' }) });
    assert.match((await detailResponse.json()).report.content, /完整证据/);
  } finally { await f.close(); }
});

test('deleting a linked work before or during execution cancels its job and suppresses publication and continuation', async () => {
  const f = await fixture();
  try {
    for (const timing of ['before', 'during']) {
      const id = `work-${timing}`;
      await f.db.spaceWork.create({ data: { id, spaceId: 'general', title: id, kind: 'DOCUMENT' } });
      const scheduled = await f.client('general', 'owner', 'analyst', '后续帮我跟进', id).execute('schedule_space_follow_up', { title: id, prompt: '检查成果', runAt: f.due.toISOString() });
      if (timing === 'before') await f.db.spaceWork.delete({ where: { id } });
      let calls = 0;
      await f.service.runSpaceFollowUpTick({ db: f.db, now: f.due, generate: async () => {
        calls++; await f.db.spaceWork.delete({ where: { id } });
        return { content: '已经核验', nextFollowUp: { title: '继续', prompt: '检查成果', runAt: new Date(f.due.getTime() + 30 * 60_000).toISOString(), reason: '继续检查' } };
      } });
      assert.equal(calls, timing === 'before' ? 0 : 1);
      assert.equal((await f.db.spaceFollowUp.findUnique({ where: { id: scheduled.id } })).status, 'CANCELLED');
    }
    assert.equal(await f.db.spaceMessage.count(), 0);
    assert.equal(await f.db.spaceFollowUpReport.count(), 0);
    assert.equal(await f.db.spaceFollowUp.count(), 2);
  } finally { await f.close(); }
});

test('removing a responsible member before or during execution suppresses reports, successors and notifications', async () => {
  const f = await fixture();
  try {
    await f.bindQQ(); await f.patch('general', { qqEnabled: true });
    for (const timing of ['before', 'during']) {
      if (timing === 'during') await f.db.spaceMember.create({ data: { spaceId: 'general', agentId: 'analyst' } });
      const saved = await f.client('general', 'owner', 'analyst', '后续帮我跟进').execute('schedule_space_follow_up', {
        title: `成员移除-${timing}`, prompt: `核验资料-${timing}`, runAt: f.due.toISOString(),
      });
      assert.equal(saved.ok, true);
      if (timing === 'before') await f.db.spaceMember.deleteMany({ where: { spaceId: 'general' } });
      let calls = 0;
      await f.service.runSpaceFollowUpTick({ db: f.db, now: f.due, generate: async () => {
        calls++; await f.db.spaceMember.deleteMany({ where: { spaceId: 'general' } });
        return { content: '已核验新资料', qqNotification: importantNotice,
          nextFollowUp: { title: '继续检查', prompt: '核验资料', runAt: new Date(f.due.getTime() + 30 * 60_000).toISOString(), reason: '检查更新' } };
      } });
      assert.equal(calls, timing === 'before' ? 0 : 1);
      assert.equal((await f.db.spaceFollowUp.findUnique({ where: { id: saved.id } })).status, 'CANCELLED');
    }
    assert.equal(await f.db.spaceMessage.count(), 0);
    assert.equal(await f.db.spaceFollowUpReport.count(), 0);
    assert.equal(await f.db.assistantReminder.count(), 0);
    assert.equal(await f.db.spaceFollowUp.count(), 2);
  } finally { await f.close(); }
});

test('clearing space contents removes reports and follow-ups, cancels queued notices and suppresses in-flight publication', async () => {
  const f = await fixture();
  try {
    // 旧讨论表由部署升级脚本初始化，而非 Prisma 迁移；复用其真实建表语句。
    const upgrade = await readFile(new URL('scripts/upgrade-agent-runtime.mjs', root), 'utf8');
    const schema = upgrade.match(/CREATE TABLE IF NOT EXISTS "SpaceDiscussion" \([\s\S]*?\n      \);/)[0];
    const sqlite = new Database(f.file);
    try { sqlite.exec(schema); } finally { sqlite.close(); }
    await f.bindQQ(); await f.patch('general', { qqEnabled: true });
    const client = f.client('general', 'owner', 'analyst', '后续继续跟进');
    const schedule = (prompt, runAt = f.due) => client.execute('schedule_space_follow_up', { title: prompt, prompt, runAt: runAt.toISOString() });
    await schedule('已完成的来源核验');
    await f.service.runSpaceFollowUpTick({ db: f.db, now: f.due, generate: async () => ({ content: '来源已更新', qqNotification: importantNotice }) });
    assert.equal(await f.db.spaceFollowUpReport.count(), 1);
    const queued = await f.db.assistantReminder.findFirst();
    const ordinary = await f.db.assistantReminder.create({ data: { userId: 'owner', content: '普通提醒', dueTime: f.due } });
    const foreign = await f.client('b', 'owner', 'analyst', '后续继续跟进').execute('schedule_space_follow_up', {
      title: '其他空间任务', prompt: '保留其他空间跟进', runAt: new Date(f.due.getTime() + 3600_000).toISOString(),
    });
    const clear = await load('app/api/spaces/[spaceId]/contents/route.ts', {
      'next/server': { NextResponse: { json: (data, options) => Response.json(data, options) } },
      '@/app/api/_lib/db': { default: f.db },
      '@/app/api/_lib/auth': { requireAuth: request => request.headers.get('x-test-user') },
      '@/app/api/_lib/agent-runs': { ACTIVE_AGENT_RUN_STATUSES: ['RUNNING', 'QUEUED'] },
      '@/app/api/_lib/spaces': { spaceRoot: () => '/fixture/not-used', ensureSpaceRoot: async () => {} },
      '@/lib/space/space-content-reset.mjs': { resetSpaceContentsStorage: async (_root, records) => records() },
    });
    const request = user => new Request('http://localhost/contents', { method: 'DELETE', headers: { 'x-test-user': user } });
    const params = { params: Promise.resolve({ spaceId: 'general' }) };
    assert.equal((await clear.DELETE(request('other'), params)).status, 404);
    await schedule('执行中核验');
    await schedule('尚未到期核验', new Date(f.due.getTime() + 3600_000));
    let calls = 0, clearResult;
    await f.service.runSpaceFollowUpTick({ db: f.db, now: f.due, generate: async () => {
      calls++;
      const response = await clear.DELETE(request('owner'), params);
      clearResult = { status: response.status, body: await response.json() };
      return { content: '清空前启动的核验结果', qqNotification: importantNotice,
        nextFollowUp: { title: '后续', prompt: '继续检查', runAt: new Date(f.due.getTime() + 30 * 60_000).toISOString(), reason: '核验更新' } };
    } });
    assert.equal(calls, 1);
    assert.equal(clearResult.status, 200, JSON.stringify(clearResult.body));
    assert.equal(clearResult.body.deleted.followUps, 3);
    assert.equal(await f.db.spaceFollowUpReport.count(), 0);
    assert.equal(await f.db.spaceMessage.count(), 0);
    assert.equal(await f.db.spaceFollowUp.count(), 1);
    assert.ok(await f.db.spaceFollowUp.findUnique({ where: { id: foreign.id } }));
    assert.equal((await f.db.assistantReminder.findUnique({ where: { id: queued.id } })).status, 'CANCELLED');
    assert.equal((await f.db.assistantReminder.findUnique({ where: { id: ordinary.id } })).status, 'PENDING');
  } finally { await f.close(); }
});

const importantNotice = {
  category: 'THESIS_INVALIDATED', eventKey: 'BTC:1H:BELOW:67064', title: 'BTC原反弹观察条件失效',
  summary: '本次新行情核验发现BTC跌破67064，原先观察条件失效；请查看本轮行情时间与完整分析。',
  reason: '原先判断发生变化，需要用户关注',
};

test('QQ notifications start off, require the existing recipient binding and keep space and user settings isolated', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.db.space.findUnique({ where: { id: 'b' } })).followUpQQEnabled, false);
    assert.equal((await f.patch('b', { qqEnabled: true })).status, 409);
    await f.bindQQ();
    assert.equal((await f.patch('b', { qqEnabled: true }, 'other')).status, 404);
    assert.equal((await f.patch('pi', { qqEnabled: true })).status, 409);
    assert.equal((await f.patch('b', { qqEnabled: true })).status, 200);
    assert.equal((await f.db.space.findUnique({ where: { id: 'a' } })).followUpQQEnabled, false);
    assert.equal((await f.db.space.findUnique({ where: { id: 'other-space' } })).followUpQQEnabled, false);
    assert.equal(await f.db.assistantReminder.count(), 0, 'enabling the switch must not send or queue anything');
  } finally { await f.close(); }
});

test('a switch closed after the initial space read cannot leave a newly scheduled task behind', async () => {
  const f = await fixture();
  try {
    const spaces = f.serviceImports['@/app/api/_lib/spaces'];
    const original = spaces.getSpaceForUser;
    let intercepted = false;
    spaces.getSpaceForUser = async (...args) => {
      const snapshot = await original(...args);
      if (!intercepted) {
        intercepted = true;
        await f.patch('b', { enabled: false });
      }
      return snapshot;
    };
    assert.equal((await f.schedule('b')).ok, false);
    assert.equal(await f.db.spaceFollowUp.count(), 0);
  } finally { await f.close(); }
});

test('QQ send eligibility uses the current binding and rejects a disabled or replaced recipient', async () => {
  const f = await fixture();
  let raw;
  try {
    const binding = await f.bindQQ(); await f.patch('b', { qqEnabled: true }); await f.schedule('b');
    await f.service.runSpaceFollowUpTick({ db: f.db, now: f.due, generate: async () => ({ content: '重要变化', qqNotification: importantNotice }) });
    const reminder = { ...await f.db.assistantReminder.findFirst(), qqOpenId: binding.qqOpenId, qqAppId: binding.appId };
    raw = new Database(f.file);
    await f.db.assistantQQBinding.update({ where: { userId: 'owner' }, data: { enabled: false } });
    assert.equal(canDeliverFollowUpQQNotification(raw, reminder, f.due), false);
    await f.db.assistantQQBinding.update({ where: { userId: 'owner' }, data: { enabled: true, qqOpenId: 'new-recipient' } });
    assert.equal(canDeliverFollowUpQQNotification(raw, reminder, f.due), false);
    assert.equal(canDeliverFollowUpQQNotification(raw, { ...reminder, qqOpenId: 'new-recipient' }, f.due), true);
  } finally { raw?.close(); await f.close(); }
});

test('offline-user backlog cannot block a ready user and due selection respects delivery and retry state', async () => {
  const f = await fixture();
  let raw;
  try {
    await f.bindQQ(); await f.bindQQ('other');
    await f.db.assistantReminder.createMany({ data: Array.from({ length: 25 }, (_, index) => ({
      userId: 'owner', content: `离线用户待办${index}`, dueTime: new Date(f.due.getTime() - 10_000),
    })) });
    const ready = await f.db.assistantReminder.create({ data: { userId: 'other', content: '在线用户应收到', dueTime: f.due } });
    await f.db.assistantReminder.createMany({ data: [
      { userId: 'other', content: '还没到时间', dueTime: new Date(f.due.getTime() + 60_000) },
      { userId: 'other', content: '重试退避中', dueTime: f.due, qqNextAttemptAt: new Date(f.due.getTime() + 60_000) },
      { userId: 'other', content: '已经发送', dueTime: f.due, qqDeliveredAt: f.due },
      { userId: 'other', content: '已经取消', dueTime: f.due, status: 'CANCELLED' },
    ] });
    raw = new Database(f.file);
    assert.deepEqual(selectDueQQReminders(raw, ['other'], f.due).map(item => item.id), [ready.id]);
    assert.equal(selectDueQQReminders(raw, [], f.due).length, 0);
  } finally { raw?.close(); await f.close(); }
});

test('expired follow-up notices are cancelled while QQ is offline without cancelling ordinary reminders', async () => {
  const f = await fixture();
  let raw;
  try {
    await f.bindQQ(); await f.patch('b', { qqEnabled: true }); await f.schedule('b');
    await f.service.runSpaceFollowUpTick({ db: f.db, now: f.due, generate: async () => ({ content: '重要变化', qqNotification: importantNotice }) });
    const notice = await f.db.assistantReminder.findFirst();
    const ordinary = await f.db.assistantReminder.create({ data: { userId: 'owner', content: '普通待办', dueTime: f.due } });
    await f.db.assistantQQBinding.update({ where: { userId: 'owner' }, data: { status: 'ERROR' } });
    raw = new Database(f.file);
    assert.equal(cancelUnavailableFollowUpQQNotifications(raw, f.due), 0, 'fresh reports should remain queued while offline');
    assert.equal(cancelUnavailableFollowUpQQNotifications(raw, new Date(f.due.getTime() + 31 * 60_000)), 1);
    assert.equal((await f.db.assistantReminder.findUnique({ where: { id: notice.id } })).status, 'CANCELLED');
    assert.equal((await f.db.assistantReminder.findUnique({ where: { id: ordinary.id } })).status, 'PENDING');
  } finally { raw?.close(); await f.close(); }
});

test('the real QQ delivery loop stops market notifications after three failed attempts across worker restarts', async () => {
  const f = await fixture();
  let raw;
  try {
    const binding = await f.bindQQ(); await f.patch('b', { qqEnabled: true }); await f.schedule('b');
    await f.service.runSpaceFollowUpTick({ db: f.db, now: f.due, generate: async () => ({ content: '重要变化', qqNotification: importantNotice }) });
    const notice = await f.db.assistantReminder.findFirst();
    const sentinel = await f.db.assistantReminder.create({ data: { userId: 'owner', content: '旧鹰眼速报', dueTime: f.due, idempotencyKey: 'crypto-sentinel:fixture' } });
    raw = new Database(f.file);
    const clock = { now: f.due };
    let calls = 0;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const deliver = await loadQQDeliveryLoop(raw, binding, clock, async () => { calls++; throw Error('fixture unavailable'); });
      await deliver();
      for (const id of [notice.id, sentinel.id]) {
        const record = await f.db.assistantReminder.findUnique({ where: { id } });
        assert.equal(record.qqDeliveryAttempts, attempt);
        assert.equal(record.status, attempt < 3 ? 'PENDING' : 'FAILED');
      }
      await deliver();
      assert.equal(calls, attempt * 2, 'polling cannot bypass the persisted backoff or the final stop');
      const record = await f.db.assistantReminder.findUnique({ where: { id: notice.id } });
      clock.now = record.qqNextAttemptAt || new Date(clock.now.getTime() + 10 * 60_000);
    }
    const restarted = await loadQQDeliveryLoop(raw, binding, clock, async () => { calls++; });
    await restarted(); await restarted();
    assert.equal(calls, 6, 'neither new follow-up nor existing Eagle alerts can attempt a fourth delivery');
    const response = await f.route.GET(new Request('http://localhost/follow-ups', { headers: { 'x-test-user': 'owner' } }), { params: Promise.resolve({ spaceId: 'b' }) });
    assert.equal((await response.json()).tasks[0].qqNotification.status, 'FAILED');
  } finally { raw?.close(); await f.close(); }
});

test('a successfully sent QQ follow-up is not resent by later polling or a new worker', async () => {
  const f = await fixture();
  let raw;
  try {
    const binding = await f.bindQQ(); await f.patch('b', { qqEnabled: true }); await f.schedule('b');
    await f.service.runSpaceFollowUpTick({ db: f.db, now: f.due, generate: async () => ({ content: '重要变化', qqNotification: importantNotice }) });
    raw = new Database(f.file);
    const clock = { now: f.due };
    let calls = 0;
    const send = async () => { calls++; return { id: 'fixture-message' }; };
    const deliver = await loadQQDeliveryLoop(raw, binding, clock, send);
    await deliver(); await deliver();
    clock.now = new Date(f.due.getTime() + 10 * 60_000);
    const restarted = await loadQQDeliveryLoop(raw, binding, clock, send);
    await restarted(); await restarted();
    assert.equal(calls, 1);
    const record = await f.db.assistantReminder.findFirst();
    assert.equal(record.qqDeliveryAttempts, 1);
    assert.equal(record.qqMessageId, 'fixture-message');
    assert.ok(record.qqDeliveredAt);
  } finally { raw?.close(); await f.close(); }
});

test('delivery claims persist attempt limits even when the worker exits before recording a result', async () => {
  const f = await fixture();
  let raw;
  try {
    const notice = await f.db.assistantReminder.create({ data: { userId: 'owner', content: '鹰眼速报', dueTime: f.due, idempotencyKey: 'crypto-sentinel:crash-fixture' } });
    const ordinary = await f.db.assistantReminder.create({ data: { userId: 'owner', content: '普通待办', dueTime: f.due, qqDeliveryAttempts: 5 } });
    raw = new Database(f.file);
    for (let attempt = 0; attempt < 3; attempt++) {
      const now = new Date(f.due.getTime() + attempt * 6 * 60_000);
      if (attempt > 0) assert.equal(claimDueQQReminder(raw, notice, now), false, 'a stale worker snapshot must not overwrite the attempt count');
      const current = await f.db.assistantReminder.findUnique({ where: { id: notice.id } });
      assert.equal(claimDueQQReminder(raw, current, now), true);
      assert.equal(claimDueQQReminder(raw, current, now), false, 'a second worker cannot share the claim');
      assert.equal(stopExhaustedMarketQQNotifications(raw, now), 0, 'the third active attempt must have time to finish');
    }
    const later = new Date(f.due.getTime() + 20 * 60_000);
    assert.equal(claimDueQQReminder(raw, notice, later), false);
    assert.equal(stopExhaustedMarketQQNotifications(raw, later), 1);
    assert.equal((await f.db.assistantReminder.findUnique({ where: { id: notice.id } })).status, 'FAILED');
    assert.equal(claimDueQQReminder(raw, ordinary, later), true, 'ordinary personal reminders keep their existing retry policy');
  } finally { raw?.close(); await f.close(); }
});

test('a late failure from an expired worker cannot reset the delivery count of the replacement worker', async () => {
  const f = await fixture();
  let raw, failOld, oldTick;
  try {
    const binding = await f.bindQQ(); await f.patch('b', { qqEnabled: true }); await f.schedule('b');
    await f.service.runSpaceFollowUpTick({ db: f.db, now: f.due, generate: async () => ({ content: '重要变化', qqNotification: importantNotice }) });
    raw = new Database(f.file);
    const clock = { now: f.due };
    let started;
    const began = new Promise(resolve => { started = resolve; });
    const pending = new Promise((_resolve, reject) => { failOld = reject; });
    const original = await loadQQDeliveryLoop(raw, binding, clock, async () => { started(); return pending; });
    oldTick = original();
    await began;
    clock.now = new Date(f.due.getTime() + 6 * 60_000);
    const replacement = await loadQQDeliveryLoop(raw, binding, clock, async () => { throw Error('replacement failed'); });
    await replacement();
    let record = await f.db.assistantReminder.findFirst();
    assert.equal(record.qqDeliveryAttempts, 2);
    const retryAt = record.qqNextAttemptAt.getTime();
    failOld(Error('old worker failed late')); await oldTick;
    record = await f.db.assistantReminder.findFirst();
    assert.equal(record.qqDeliveryAttempts, 2);
    assert.equal(record.qqNextAttemptAt.getTime(), retryAt);
    clock.now = new Date(retryAt);
    await replacement();
    record = await f.db.assistantReminder.findFirst();
    assert.equal(record.qqDeliveryAttempts, 3);
    assert.equal(record.status, 'FAILED');
  } finally { failOld?.(Error('cleanup')); await oldTick; raw?.close(); await f.close(); }
});

test('important background findings hand off to Eagle through the existing QQ queue, once, with visible delivery status', async () => {
  const f = await fixture();
  try {
    await f.bindQQ(); await f.patch('b', { qqEnabled: true });
    const root = await f.schedule('b');
    const generate = async () => ({ content: '本轮复查：观察条件失效', analystName: '凌风 · 盘面K线先锋', qqNotification: {
      ...importantNotice, userId: 'other', spaceId: 'other-space', qqOpenId: 'untrusted-recipient',
    } });
    await Promise.all([
      f.service.runSpaceFollowUpTick({ db: f.db, now: f.due, generate }),
      f.service.runSpaceFollowUpTick({ db: f.db, now: f.due, generate }),
    ]);
    assert.equal(await f.db.agentQQBinding.count(), 0, 'no separate Eagle bot is required');
    assert.equal(await f.db.assistantReminder.count(), 1);
    const reminder = await f.db.assistantReminder.findFirst();
    assert.equal(reminder.userId, 'owner');
    assert.match(reminder.content, /鹰眼·自主复查重要速报/);
    assert.match(reminder.content, /凌风 · 盘面K线先锋/);
    assert.match(reminder.content, /空间：B/);
    assert.doesNotMatch(reminder.content, /untrusted-recipient/);
    assert.equal((await f.db.spaceFollowUp.findUnique({ where: { id: root.id } })).qqReminderId, reminder.id);
    assert.match((await f.db.spaceMessage.findFirst()).content, /加入现有 QQ 通知队列/);
    const get = () => f.route.GET(new Request('http://localhost/follow-ups', { headers: { 'x-test-user': 'owner' } }), { params: Promise.resolve({ spaceId: 'b' }) });
    assert.equal((await (await get()).json()).tasks[0].qqNotification.status, 'PENDING');
    await f.db.assistantReminder.update({ where: { id: reminder.id }, data: { qqDeliveryError: 'fixture offline' } });
    assert.equal((await (await get()).json()).tasks[0].qqNotification.status, 'RETRYING');
    await f.db.assistantReminder.update({ where: { id: reminder.id }, data: { qqDeliveredAt: f.due } });
    assert.equal((await (await get()).json()).tasks[0].qqNotification.status, 'SENT');
  } finally { await f.close(); }
});

test('ordinary follow-ups stay in the space and duplicate events and rapid notifications are suppressed', async () => {
  const f = await fixture();
  try {
    await f.bindQQ(); await f.patch('b', { qqEnabled: true });
    const createTask = offset => f.client('b').execute('schedule_space_follow_up', {
      title: 'BTC复查', prompt: `BTC复查${offset}`, runAt: new Date(f.due.getTime() + offset).toISOString(),
    });
    await createTask(0);
    await f.service.runSpaceFollowUpTick({ db: f.db, now: f.due, generate: async () => ({ content: '盘面无明显变化，继续观察。' }) });
    assert.equal(await f.db.assistantReminder.count(), 0);
    for (const [offset, notice] of [[60_000, importantNotice], [7 * 60_000, importantNotice], [8 * 60_000, { ...importantNotice, eventKey: 'ETH:1H:BELOW:3000' }]]) {
      await createTask(offset);
      await f.service.runSpaceFollowUpTick({ db: f.db, now: new Date(f.due.getTime() + offset), generate: async () => ({ content: '重要变化', qqNotification: notice }) });
    }
    assert.equal(await f.db.assistantReminder.count(), 2, 'same event is suppressed for 30min; a new event after cooldown can notify');
    const rapid = 9 * 60_000;
    await createTask(rapid);
    await f.service.runSpaceFollowUpTick({ db: f.db, now: new Date(f.due.getTime() + rapid), generate: async () => ({ content: '另一项变化', qqNotification: { ...importantNotice, eventKey: 'SOL:1H:BELOW:100' } }) });
    assert.equal(await f.db.assistantReminder.count(), 2);
    assert.equal(await f.db.spaceMessage.count(), 5, 'suppression must not drop the full report');
  } finally { await f.close(); }
});

test('turning QQ notifications off during generation suppresses its proposal while retaining the analysis, and cancels queued work', async () => {
  const f = await fixture();
  try {
    await f.bindQQ(); await f.patch('b', { qqEnabled: true }); await f.schedule('b');
    await f.service.runSpaceFollowUpTick({ db: f.db, now: f.due, generate: async () => {
      await f.patch('b', { qqEnabled: false });
      return { content: '这个分析需要保留', qqNotification: importantNotice };
    } });
    assert.equal(await f.db.assistantReminder.count(), 0);
    assert.match((await f.db.spaceMessage.findFirst()).content, /这个分析需要保留/);
    await f.patch('b', { qqEnabled: true });
    const later = new Date(f.due.getTime() + 60_000);
    await f.client('b').execute('schedule_space_follow_up', { title: 'BTC继续', prompt: 'BTC继续', runAt: later.toISOString() });
    await f.service.runSpaceFollowUpTick({ db: f.db, now: later, generate: async () => ({ content: '重要变化', qqNotification: importantNotice }) });
    const reminder = await f.db.assistantReminder.findFirst();
    assert.equal(reminder.status, 'PENDING');
    await f.patch('b', { enabled: false });
    assert.equal((await f.db.assistantReminder.findUnique({ where: { id: reminder.id } })).status, 'CANCELLED');
  } finally { await f.close(); }
});

test('QQ worker rechecks owner, switches, cancellation and expiry before sending a short Eagle bulletin', async () => {
  const f = await fixture();
  let raw;
  try {
    const binding = await f.bindQQ(); await f.patch('b', { qqEnabled: true }); await f.schedule('b');
    await f.service.runSpaceFollowUpTick({ db: f.db, now: f.due, generate: async () => ({ content: '重要变化', qqNotification: importantNotice }) });
    const reminder = { ...await f.db.assistantReminder.findFirst(), qqOpenId: binding.qqOpenId, qqAppId: binding.appId };
    raw = new Database(f.file);
    assert.equal(canDeliverFollowUpQQNotification(raw, reminder, f.due), true);
    assert.equal(canDeliverFollowUpQQNotification(raw, { ...reminder, userId: 'other' }, f.due), false);
    assert.equal(canDeliverFollowUpQQNotification(raw, reminder, new Date(f.due.getTime() + 31 * 60_000)), false);
    assert.equal(formatQQReminderMessage(reminder), reminder.content);
    assert.match(formatQQReminderMessage({ content: '买菜' }), /完成了/);
    await f.patch('b', { qqEnabled: false });
    assert.equal(canDeliverFollowUpQQNotification(raw, reminder, f.due), false);
    await f.patch('b', { qqEnabled: true });
    assert.equal(canDeliverFollowUpQQNotification(raw, reminder, f.due), false, 're-enabling must not resurrect cancelled notices');
  } finally { raw?.close(); await f.close(); }
});

test('only an explicit request for future follow-up can seed a chain from a user turn', () => {
  for (const text of ['看看BTC', '当前呢', '资金费率负了是什么意思', '我临时问一下ETH', '不用继续跟进了', '解释一下定时复查机制', '你支持自动复查吗',
    '我开启了自动观测', '不要再次查询BTC', '不用再观察了', '解释一下自动观测机制', '你是怎么决定下次什么时候再次查询的']) {
    assert.equal(policy.isExplicitFollowUpRequest(text), false, text);
  }
  for (const text of ['咱们几点再看一次呢', '半小时后再看看BTC', '半个小时后帮我再看BTC', '一个小时后再看BTC', '20分钟后复查ETH', '帮我继续跟进BTC', '到21:00你自己看看BTC', '稍后再看一次',
    '我开启了，自动观测！你下次什么时候回再次查询呢', '你下次什么时候会再次查询呢', '多久后再观察BTC', '下一次什么时候再查看ETH', '半小时后再次查询BTC']) {
    assert.equal(policy.isExplicitFollowUpRequest(text), true, text);
  }
});

test('asking when to query again exposes scheduling and can persist a first check after an empty task list', async () => {
  const f = await fixture();
  try {
    const client = f.client('b', 'owner', 'analyst', '我开启了，自动观测！你下次什么时候回再次查询呢');
    assert.equal(client.tools.some(tool => tool.function.name === 'schedule_space_follow_up'), true);
    const empty = await client.execute('list_space_follow_ups', {});
    assert.equal(empty.ok, true);
    assert.equal(empty.tasks.length, 0);
    assert.equal(empty.schedulingAllowed, true);
    assert.match(empty.nextStep, /调用 schedule_space_follow_up 保存首次复查/);
    assert.equal(await f.db.spaceFollowUp.count(), 0, 'listing or enabling alone must not create a task');
    const args = { title: 'BTC 下次收线复查', prompt: '查询BTC最新行情，对比67487压力位是否收复', runAt: f.due.toISOString() };
    const scheduled = await client.execute('schedule_space_follow_up', args);
    assert.equal(scheduled.ok, true);
    assert.equal(scheduled.runAt, f.due.toISOString());
    const listed = await client.execute('list_space_follow_ups', {});
    assert.equal(listed.tasks.length, 1);
    assert.equal(listed.tasks[0].id, scheduled.id);
    assert.equal(listed.tasks[0].status, 'PENDING');
    assert.equal(listed.tasks[0].agentId, 'analyst');
    assert.match((await f.db.spaceFollowUp.findUnique({ where: { id: scheduled.id } })).context, /BTC.*67487/);
    assert.equal((await client.execute('schedule_space_follow_up', args)).id, scheduled.id);
    assert.equal(await f.db.spaceFollowUp.count(), 1, 'repeating a successful tool call must reuse the saved task');
    const statusOnly = f.client('b', 'owner', 'analyst', '看看当前任务列表');
    const status = await statusOnly.execute('list_space_follow_ups', {});
    assert.equal(status.schedulingAllowed, false);
    assert.equal(statusOnly.tools.some(tool => tool.function.name === 'schedule_space_follow_up'), false);
  } finally { await f.close(); }
});

test('autonomous continuations enforce time, depth and justification bounds', () => {
  const now = new Date('2026-11-14T13:00:00Z');
  const parent = { id: 'parent', runAt: now, chainDepth: 0 };
  const next = { title: 'BTC', prompt: '复查BTC', runAt: '2026-11-14T13:30:00Z', reason: '等待下一根1H收线' };
  const normalized = policy.normalizeFollowUpContinuation(parent, next, now);
  assert.equal(normalized.chainDepth, 1);
  assert.equal(normalized.parentId, 'parent');
  assert.equal(normalized.origin, 'AI_FOLLOW_UP');
  assert.equal(policy.normalizeFollowUpContinuation(parent, normalized, now).runAt.toISOString(), next.runAt.replace('Z', '.000Z'));
  assert.throws(() => policy.normalizeFollowUpContinuation(parent, { ...next, reason: '' }, now), /原因/);
  assert.throws(() => policy.normalizeFollowUpContinuation(parent, { ...next, runAt: '2026-11-14T13:05:00Z' }, now), /15分钟/);
  assert.throws(() => policy.normalizeFollowUpContinuation(parent, { ...next, runAt: '2026-11-15T14:00:00Z' }, now), /24小时/);
  assert.throws(() => policy.normalizeFollowUpContinuation({ ...parent, chainDepth: 3 }, next, now), /上限/);
  assert.equal(policy.canContinueFollowUp({ ...parent, chainEndsAt: new Date(now.getTime() + 10 * 60_000) }, now), false);
});

test('system progress distinguishes the first check, each continuation and the time limit', () => {
  const now = new Date('2026-11-15T04:05:00Z');
  const task = { runAt: now };
  assert.match(policy.formatFollowUpProgress(task, now), /首次复查；自动续查额度剩余 3\/3/);
  for (const depth of [1, 2, 3]) {
    const progress = policy.followUpProgress({ ...task, chainDepth: depth }, now);
    assert.equal(progress.remaining, 3 - depth);
    assert.equal(progress.stopReason, depth === 3 ? 'LIMIT_REACHED' : null);
    assert.match(policy.formatFollowUpProgress({ ...task, chainDepth: depth }, now), new RegExp(`第 ${depth}/3 次自动续查`));
  }
  const nearDeadline = { ...task, chainDepth: 1, chainEndsAt: new Date(now.getTime() + 14 * 60_000) };
  assert.equal(policy.followUpProgress(nearDeadline, now).stopReason, 'DEADLINE');
  assert.match(policy.formatFollowUpProgress(nearDeadline, now), /剩余时间/);
  assert.doesNotMatch(policy.formatFollowUpProgress(nearDeadline, now), /次数上限/);
});

test('configured continuation quotas include zero and preserve the time and spacing constraints', () => {
  const now = new Date('2026-11-15T04:05:00Z');
  const task = { id: 'parent', runAt: now, chainDepth: 3, maxChainDepth: 6 };
  assert.equal(policy.canContinueFollowUp(task, now), true);
  assert.match(policy.formatFollowUpProgress(task, now), /第 3\/6 次自动续查；自动续查额度剩余 3\/6/);
  assert.equal(policy.canContinueFollowUp({ ...task, maxChainDepth: 0, chainDepth: 0 }, now), false);
  assert.equal(policy.canContinueFollowUp({ ...task, chainDepth: 6 }, now), false);
  assert.equal(policy.normalizeFollowUpLimit(0), 0);
  assert.equal(policy.normalizeFollowUpLimit(24), 24);
  for (const value of [-1, 25, 1.5, '6', null, true]) assert.throws(() => policy.normalizeFollowUpLimit(value), /整数/);
  const proposal = { title: 'BTC', prompt: '核验BTC收线', reason: '等待收线', runAt: new Date(now.getTime() + 30 * 60_000).toISOString() };
  const next = policy.normalizeFollowUpContinuation(task, proposal, now);
  assert.equal(next.maxChainDepth, 6);
  assert.equal(next.chainDepth, 4);
  assert.throws(() => policy.normalizeFollowUpContinuation(task, { ...proposal, runAt: new Date(now.getTime() + 5 * 60_000).toISOString() }, now), /15分钟/);
  assert.throws(() => policy.normalizeFollowUpContinuation(task, { ...proposal, runAt: new Date(now.getTime() + 25 * 60 * 60_000).toISOString() }, now), /24小时/);
});

test('quota settings persist per space, validate input and only change newly created chains', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.db.space.findUnique({ where: { id: 'b' } })).followUpMaxContinuations, 3);
    const original = await f.schedule('b');
    assert.equal(original.maxChainDepth, 3);
    for (const value of [-1, 25, 1.5, '6', null, true]) assert.equal((await f.patch('b', { maxContinuations: value })).status, 400);
    assert.equal((await f.patch('b', { maxContinuations: 6 }, 'other')).status, 404);
    assert.equal((await f.patch('pi', { maxContinuations: 6 })).status, 409);
    assert.equal((await f.patch('b', { maxContinuations: 6 })).status, 200);
    const next = await f.client('b').execute('schedule_space_follow_up', { title: 'ETH收线', prompt: '复查ETH最新行情', runAt: f.due.toISOString() });
    assert.equal(next.maxChainDepth, 6);
    assert.equal((await f.schedule('b')).id, original.id, 'retrying the original scheduling call must not change its saved quota');
    assert.equal((await f.db.spaceFollowUp.findUnique({ where: { id: original.id } })).maxChainDepth, 3);
    assert.equal((await f.db.space.findUnique({ where: { id: 'a' } })).followUpMaxContinuations, 3);
    assert.equal((await f.db.space.findUnique({ where: { id: 'other-space' } })).followUpMaxContinuations, 3);
    const get = await f.route.GET(new Request('http://localhost/follow-ups?view=history', { headers: { 'x-test-user': 'owner' } }), { params: Promise.resolve({ spaceId: 'b' }) });
    const history = await get.json();
    assert.equal(history.settings.maxContinuations, 6);
    assert.equal(history.settings.maxAllowedContinuations, 24);
    assert.deepEqual(history.tasks.map(task => task.maxChainDepth).sort(), [3, 6]);
    assert.equal((await f.patch('a', { maxContinuations: 0 })).status, 200);
    assert.equal((await f.db.space.findUnique({ where: { id: 'a' } })).followUpEnabled, false, 'saving a quota never enables observation');
  } finally { await f.close(); }
});

test('the scheduler follows a saved six-continuation quota after the space setting changes, while zero still permits the initial report', async () => {
  const f = await fixture();
  try {
    await f.patch('b', { maxContinuations: 6 });
    const root = await f.schedule('b');
    await f.patch('b', { maxContinuations: 1 });
    let calls = 0;
    let now = f.due;
    const generate = async () => ({ content: `复查${++calls}`, nextFollowUp: {
      title: 'BTC后续', prompt: '复查BTC', reason: '等待收线', runAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
    } });
    for (let round = 0; round < 7; round++) {
      await f.service.runSpaceFollowUpTick({ db: f.db, now, generate });
      now = new Date(now.getTime() + 30 * 60_000);
    }
    assert.equal(calls, 7);
    const chain = await f.db.spaceFollowUp.findMany({ where: { spaceId: 'b' }, orderBy: { chainDepth: 'asc' } });
    assert.deepEqual(chain.map(task => task.chainDepth), [0, 1, 2, 3, 4, 5, 6]);
    assert.ok(chain.every(task => task.maxChainDepth === 6 && task.status === 'COMPLETED'));
    assert.equal(chain[0].id, root.id);
    const reports = await f.db.spaceMessage.findMany({ where: { spaceId: 'b' }, orderBy: { createdAt: 'asc' } });
    assert.match(reports[4].content, /第 4\/6 次自动续查/);
    assert.match(reports.at(-1).content, /第 6\/6 次自动续查；已达到自动续查次数上限/);
    await f.patch('a', { maxContinuations: 0 }); await f.patch('a', { enabled: true });
    const once = await f.schedule('a');
    assert.equal(once.maxChainDepth, 0);
    await f.service.runSpaceFollowUpTick({ db: f.db, now, generate });
    assert.equal(await f.db.spaceFollowUp.count({ where: { spaceId: 'a' } }), 1);
    assert.equal(await f.db.spaceMessage.count({ where: { spaceId: 'a' } }), 1);
    assert.equal((await f.db.spaceFollowUp.findUnique({ where: { id: once.id } })).status, 'COMPLETED');
  } finally { await f.close(); }
});

test('a temporary question cannot schedule even when older history requested follow-up and the switch is on', async () => {
  const f = await fixture();
  try {
    for (const question of ['看看BTC', '当前呢', '我开启了自动观测', '不要再次查询BTC', '解释一下自动观测机制']) {
      const client = f.client('b', 'owner', 'analyst', question);
      assert.equal(client.tools.some(tool => tool.function.name === 'schedule_space_follow_up'), false);
      const result = await client.execute('schedule_space_follow_up', { title: 'BTC', prompt: 'BTC新行情', runAt: f.due.toISOString() });
      assert.equal(result.ok, false);
    }
    assert.equal(await f.db.spaceFollowUp.count(), 0);
  } finally { await f.close(); }
});

test('migration defaults each contract space to off; tools only schedule after its own switch is enabled', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.db.space.findUnique({ where: { id: 'a' } })).followUpEnabled, false);
    assert.equal((await f.schedule()).ok, false);
    assert.equal((await f.patch('a', { enabled: true })).status, 200);
    const first = await f.schedule();
    const repeat = await f.schedule();
    assert.equal(first.ok, true);
    assert.equal(first.id, repeat.id, 'repeated tool call must reuse its persisted task');
    assert.equal(await f.db.spaceFollowUp.count(), 1);
    const task = await f.db.spaceFollowUp.findUnique({ where: { id: first.id } });
    assert.equal(task.spaceId, 'a');
    assert.equal(task.agentId, 'analyst');
    assert.match(task.context, /67487/);
    assert.equal((await f.client('pi').execute('schedule_space_follow_up', { title: 'x', prompt: 'x', runAt: f.due.toISOString() })).ok, false);
    assert.equal((await f.client('a', 'owner', 'removed-member').execute('schedule_space_follow_up', {})).ok, false);
  } finally { await f.close(); }
});

test('users and separate copies of the same template cannot read or cancel each other’s tasks', async () => {
  const f = await fixture();
  try {
    await f.patch('a', { enabled: true });
    const a = await f.schedule('a'), b = await f.schedule('b');
    assert.notEqual(a.id, b.id);
    assert.equal((await f.client('a', 'other').execute('list_space_follow_ups', {})).ok, false);
    assert.equal((await f.client('a').execute('cancel_space_follow_up', { id: b.id })).ok, false);
    assert.equal((await f.patch('a', { id: b.id })).status, 404);
    assert.equal((await f.patch('a', { enabled: false }, 'other')).status, 404);
    assert.equal((await f.patch('pi', { enabled: true })).status, 409);
    const response = await f.route.GET(new Request('http://localhost/follow-ups', { headers: { 'x-test-user': 'owner' } }), { params: Promise.resolve({ spaceId: 'a' }) });
    const data = await response.json();
    assert.equal(data.tasks.length, 1);
    assert.equal(data.tasks[0].id, a.id);
    assert.equal((await f.db.spaceFollowUp.findUnique({ where: { id: b.id } })).status, 'PENDING');
  } finally { await f.close(); }
});

test('the records area paginates all history, filters status and scopes report details to the owner and space', async () => {
  const f = await fixture();
  try {
    await f.db.spaceFollowUp.createMany({ data: Array.from({ length: 27 }, (_, index) => ({
      id: `history-${index}`, spaceId: 'b', agentId: 'analyst', title: `BTC记录${index}`, prompt: '比较压力位', context: 'private context',
      sourceKey: `history-source-${index}`, runAt: new Date(f.due.getTime() - index * 60_000), nextAttemptAt: f.due,
      status: index < 23 ? 'COMPLETED' : index === 23 ? 'FAILED' : index === 24 ? 'CANCELLED' : 'PENDING',
    })) });
    const foreign = await f.schedule('other-space');
    await f.db.spaceMessage.create({ data: { spaceId: 'b', role: 'assistant', speakerAgentId: 'analyst', sourceKey: 'space-follow-up:history-0', content: '完整复查汇报：已核验收线' } });
    const get = (query, spaceId = 'b', userId = 'owner') => f.route.GET(new Request(`http://localhost/follow-ups?${query}`, {
      headers: { 'x-test-user': userId },
    }), { params: Promise.resolve({ spaceId }) });
    const first = await (await get('view=history')).json();
    const second = await (await get('view=history&page=2')).json();
    assert.equal(first.total, 27); assert.equal(first.pageSize, 20); assert.equal(first.tasks.length, 20);
    assert.equal(second.tasks.length, 7);
    assert.equal(new Set([...first.tasks, ...second.tasks].map(task => task.id)).size, 27);
    assert.equal('context' in first.tasks[0], false);
    assert.equal('prompt' in first.tasks[0], false);
    assert.equal((await (await get('view=history&page=999')).json()).page, 2);
    for (const [status, count] of [['ACTIVE', 2], ['COMPLETED', 23], ['FAILED', 1], ['CANCELLED', 1]]) {
      assert.equal((await (await get(`view=history&status=${status}`)).json()).total, count);
    }
    assert.equal((await get('view=history&status=invalid')).status, 400);
    assert.equal((await get('view=history&page=-1')).status, 400);
    const detail = await (await get('taskId=history-0')).json();
    assert.equal(detail.task.id, 'history-0');
    assert.equal(detail.report.content, '完整复查汇报：已核验收线');
    assert.equal((await (await get('taskId=history-26')).json()).report, null);
    assert.equal((await get(`taskId=${foreign.id}`)).status, 404);
    assert.equal((await get('taskId=history-0', 'other-space', 'other')).status, 404);
    assert.equal((await get('view=history', 'b', 'other')).status, 404);
  } finally { await f.close(); }
});

test('a persisted follow-up runs once after its deadline and reports as its original member in its original space', async () => {
  const f = await fixture();
  try {
    const scheduled = await f.schedule('b');
    let calls = 0;
    const generate = async task => { calls++; assert.equal(task.context.includes('67487'), true); return { content: '本次复查已查询新行情，压力位仍未收复' }; };
    await f.service.runSpaceFollowUpTick({ db: f.db, now: new Date(f.due.getTime() - 1), generate });
    assert.equal(calls, 0);
    await Promise.all([
      f.service.runSpaceFollowUpTick({ db: f.db, now: f.due, generate }),
      f.service.runSpaceFollowUpTick({ db: f.db, now: f.due, generate }),
    ]);
    assert.equal(calls, 1);
    await f.service.runSpaceFollowUpTick({ db: f.db, now: new Date(f.due.getTime() + 600_000), generate });
    assert.equal(calls, 1);
    const messages = await f.db.spaceMessage.findMany();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].spaceId, 'b');
    assert.equal(messages[0].speakerAgentId, 'analyst');
    assert.match(messages[0].content, /本轮跟进已结束，本次未安排后续复查/);
    assert.equal((await f.db.spaceFollowUp.findUnique({ where: { id: scheduled.id } })).status, 'COMPLETED');
  } finally { await f.close(); }
});

test('a continuation that runs out of time during generation is not saved or reported as scheduled', async () => {
  const f = await fixture();
  try {
    const scheduled = await f.schedule('b');
    const startedAt = new Date(Date.now() - 120_000);
    const chainEndsAt = new Date(Date.now() + 14 * 60_000);
    await f.db.spaceFollowUp.update({ where: { id: scheduled.id }, data: {
      runAt: startedAt, nextAttemptAt: startedAt, chainEndsAt,
    } });
    await f.service.runSpaceFollowUpTick({ db: f.db, now: startedAt, generate: async task => {
      assert.equal(policy.canContinueFollowUp(task, startedAt), true);
      return { content: '本轮核验完成', nextFollowUp: {
        title: 'BTC下一次核验', prompt: '核验BTC', reason: '等待收线', runAt: chainEndsAt.toISOString(),
      } };
    } });
    assert.equal(await f.db.spaceFollowUp.count(), 1);
    const message = await f.db.spaceMessage.findFirst();
    assert.match(message.content, /已无满足最小间隔的剩余时间/);
    assert.match(message.content, /本次未安排后续复查/);
    assert.doesNotMatch(message.content, /下次自主复查：/);
    assert.equal((await f.db.spaceFollowUp.findUnique({ where: { id: scheduled.id } })).status, 'COMPLETED');
  } finally { await f.close(); }
});

test('turning off one space cancels its running and pending work and suppresses an in-flight reply', async () => {
  const f = await fixture();
  try {
    await f.patch('a', { enabled: true });
    const scheduled = await f.schedule();
    const b = await f.schedule('b');
    // B's task is not due in this tick, to isolate the in-flight A task.
    await f.db.spaceFollowUp.update({ where: { id: b.id }, data: { nextAttemptAt: new Date(f.due.getTime() + 600_000) } });
    let started, finish;
    const startedPromise = new Promise(done => { started = done; });
    const generated = new Promise(done => { finish = done; });
    const tick = f.service.runSpaceFollowUpTick({ db: f.db, now: f.due, generate: async () => { started(); return generated; } });
    await startedPromise;
    assert.equal((await f.patch('a', { enabled: false })).status, 200);
    finish({ content: 'This must not be published', nextFollowUp: {
      title: 'BTC后续', prompt: 'BTC继续复查', reason: '等待收线', runAt: new Date(f.due.getTime() + 30 * 60_000).toISOString(),
    } });
    await tick;
    assert.equal(await f.db.spaceMessage.count(), 0);
    assert.equal(await f.db.spaceFollowUp.count(), 2, 'turning off must also suppress the proposed child task');
    assert.equal((await f.db.spaceFollowUp.findUnique({ where: { id: scheduled.id } })).status, 'CANCELLED');
    assert.equal((await f.db.spaceFollowUp.findUnique({ where: { id: b.id } })).status, 'PENDING');
    assert.equal((await f.schedule()).ok, false);
  } finally { await f.close(); }
});

test('a delayed scheduler catches up a saved overdue check and writes one report in the original space', async () => {
  const f = await fixture();
  try {
    const saved = await f.schedule('b');
    const resumedAt = new Date(f.due.getTime() + 30 * 60_000);
    let calls = 0;
    const generate = async task => {
      calls++;
      assert.equal(new Date(task.runAt).getTime(), f.due.getTime());
      assert.equal(task.startedAt.getTime(), resumedAt.getTime());
      return { content: '延迟补查：依据恢复执行时的新行情汇报，不冒充原定时点的数据。' };
    };
    await f.service.runSpaceFollowUpTick({ db: f.db, now: resumedAt, generate });
    await f.service.runSpaceFollowUpTick({ db: f.db, now: resumedAt, generate });
    assert.equal(calls, 1);
    assert.equal((await f.db.spaceFollowUp.findUnique({ where: { id: saved.id } })).status, 'COMPLETED');
    const messages = await f.db.spaceMessage.findMany();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].spaceId, 'b');
    assert.equal(messages[0].speakerAgentId, 'analyst');
    assert.equal(messages[0].sourceKey, `space-follow-up:${saved.id}`);
    assert.match(messages[0].content, /恢复执行时的新行情/);
  } finally { await f.close(); }
});

test('failed execution backs off, retries at most three times and leaves a visible failure without fabricated analysis', async () => {
  const f = await fixture();
  try {
    const scheduled = await f.schedule('b');
    let calls = 0;
    const generate = async () => { calls++; throw Error('fixture model unavailable'); };
    let now = f.due;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await f.service.runSpaceFollowUpTick({ db: f.db, now, generate });
      const task = await f.db.spaceFollowUp.findUnique({ where: { id: scheduled.id } });
      assert.equal(task.attempts, attempt);
      assert.equal(task.status, attempt < 3 ? 'PENDING' : 'FAILED');
      await f.service.runSpaceFollowUpTick({ db: f.db, now, generate });
      assert.equal(calls, attempt, 'must wait for retry backoff');
      now = task.nextAttemptAt;
    }
    const messages = await f.db.spaceMessage.findMany();
    assert.equal(messages.length, 1);
    assert.match(messages[0].content, /未取得可靠结果/);
  } finally { await f.close(); }
});

test('an expired execution lease is reclaimed after a restart', async () => {
  const f = await fixture();
  try {
    const scheduled = await f.schedule('b');
    await f.db.spaceFollowUp.update({ where: { id: scheduled.id }, data: {
      status: 'RUNNING', attempts: 1, claimToken: 'stale-process', leaseUntil: new Date(f.due.getTime() - 1),
    } });
    await f.service.runSpaceFollowUpTick({ db: f.db, now: f.due, generate: async () => ({ content: '恢复后完成复查' }) });
    assert.equal(await f.db.spaceMessage.count(), 1);
    assert.equal((await f.db.spaceFollowUp.findUnique({ where: { id: scheduled.id } })).attempts, 2);
  } finally { await f.close(); }
});

test('AI follow-ups inherit the original space, member and horizon, stop after three continuations and never branch', async () => {
  const f = await fixture();
  try {
    const root = await f.schedule('b');
    let now = f.due;
    let calls = 0;
    const generate = async () => ({ content: `复查${++calls}：仍需要等收线确认`, nextFollowUp: {
      title: 'BTC后续复查', prompt: '查询BTC新行情，核验压力位', reason: '等待下一根K线确认',
      runAt: new Date(now.getTime() + 30 * 60_000).toISOString(), spaceId: 'other-space', agentId: 'wrong-agent',
    } });
    for (let index = 0; index < 4; index++) {
      await Promise.all([
        f.service.runSpaceFollowUpTick({ db: f.db, now, generate }),
        f.service.runSpaceFollowUpTick({ db: f.db, now, generate }),
      ]);
      assert.equal(calls, index + 1);
      now = new Date(now.getTime() + 30 * 60_000);
    }
    assert.equal(await f.db.spaceFollowUp.count(), 4);
    assert.equal(await f.db.spaceFollowUp.count({ where: { status: 'PENDING' } }), 0);
    const children = await f.db.spaceFollowUp.findMany({ where: { origin: 'AI_FOLLOW_UP' }, orderBy: { chainDepth: 'asc' } });
    assert.deepEqual(children.map(task => task.chainDepth), [1, 2, 3]);
    assert.equal(children[0].parentId, root.id);
    for (const child of children) {
      assert.equal(child.spaceId, 'b'); assert.equal(child.agentId, 'analyst');
      assert.equal(child.chainEndsAt.getTime(), f.due.getTime() + 86_400_000);
    }
    const messages = await f.db.spaceMessage.findMany({ orderBy: { createdAt: 'asc' } });
    assert.equal(messages.length, 4);
    assert.match(messages[0].content, /下次自主复查.*等待下一根K线确认/s);
    assert.match(messages[0].content, /首次复查；自动续查额度剩余 3\/3/);
    assert.match(messages[0].content, /已保存第 1\/3 次自动续查；该次执行后最多还可续查 2 次/);
    assert.match(messages[2].content, /第 2\/3 次自动续查；自动续查额度剩余 1\/3/);
    assert.match(messages[2].content, /已保存第 3\/3 次自动续查；该次执行后最多还可续查 0 次/);
    assert.match(messages.at(-1).content, /上限/);
    assert.match(messages.at(-1).content, /第 3\/3 次自动续查/);
    const response = await f.route.GET(new Request('http://localhost/follow-ups', { headers: { 'x-test-user': 'owner' } }), { params: Promise.resolve({ spaceId: 'b' }) });
    const { tasks } = await response.json();
    assert.deepEqual(tasks.map(task => task.chainDepth).sort(), [0, 1, 2, 3]);
    assert.ok(tasks.every(task => task.maxChainDepth === 3));
  } finally { await f.close(); }
});

test('background analysis obtains a new market snapshot before calling the member model and refuses to reuse old prices on failure', async () => {
  const f = await fixture();
  try {
    const scheduled = await f.schedule('b');
    const task = await f.db.spaceFollowUp.findUnique({ where: { id: scheduled.id }, include: { space: { select: { userId: true } } } });
    let queries = 0, modelCalls = 0;
    let marketAvailable = true;
    let proposeNext = false;
    let proposeNotice = false;
    let oiWindow = null;
    let expectedMax = 3;
    const nextRunAt = new Date(f.due.getTime() + 30 * 60_000).toISOString();
    const domain = await load('lib/space/follow-up-domains.ts', {
      '../workspace/crypto/okx-analysis.mjs': analysis,
      '../workspace/crypto/market-tools': { queryCryptoMarket: async (name, { symbol }) => {
        queries++; assert.equal(name, 'crypto_market_snapshot'); assert.equal(symbol, 'BTC');
        return marketAvailable ? { price: 112, realtimeFetchedAt: new Date().toISOString(), derivativesFetchedAt: '2026-11-15T04:05:00Z', oiDelta1hPercent: 2.82, oiDelta1hWindow: oiWindow, dataQuality: { ticker: true } } : null;
      } },
    });
    const generate = await load('lib/space/follow-up-service.ts', {
      ...f.serviceImports,
      '@/app/api/_lib/spaces': { ...f.serviceImports['@/app/api/_lib/spaces'],
        resolveAgent: async () => ({ id: 'analyst', name: 'Analyst', systemPrompt: 'Analyze carefully' }),
        resolveSpaceMemberModelConfig: async ({ spaceId, userId }) => {
          assert.equal(spaceId, 'b'); assert.equal(userId, 'owner');
          return { model: 'fixture', client: { chat: { completions: { async *create(body) {
            modelCalls++;
            assert.equal(queries, 1, 'fetch must finish before the model reasons about the current market');
            assert.match(body.messages[0].content, /"price":112/);
            assert.match(body.messages[0].content, /进入候选方案评估的条件/);
            assert.match(body.messages[0].content, /结束当前观察的条件/);
            assert.match(body.messages[0].content, /沿用同一统计窗口，未获得新窗口确认/);
            assert.match(body.messages[0].content, /窗口更新但数值相同/);
            if (expectedMax > 0) assert.ok(body.messages[0].content.includes(`首次复查；自动续查额度剩余 ${expectedMax}/${expectedMax}`));
            else assert.match(body.messages[0].content, /已达到自动续查次数上限/);
            if (modelCalls === 1) assert.equal(Boolean(body.tools?.some(tool => tool.function.name === 'schedule_next_space_follow_up')), expectedMax > 0);
            assert.match(body.messages[0].content, /正文不要自行称“末次\/最后一次”/);
            assert.match(body.messages[1].content, /67487/);
            if (proposeNext && modelCalls === 1) {
              assert.ok(body.tools.some(tool => tool.function.name === 'schedule_next_space_follow_up'));
              const toolCalls = [{ index: 0, id: 'next-check', type: 'function', function: {
                name: 'schedule_next_space_follow_up', arguments: JSON.stringify({ title: 'BTC下一根收线复查', prompt: '查询BTC新行情，对比压力位', runAt: nextRunAt, reason: '等待下一根1H收线确认突破' }),
              } }];
              if (proposeNotice) {
                assert.ok(body.tools.some(tool => tool.function.name === 'request_sentinel_qq_notification'));
                toolCalls.push({ index: 1, id: 'eagle-notice', type: 'function', function: { name: 'request_sentinel_qq_notification', arguments: JSON.stringify(importantNotice) } });
              }
              yield { choices: [{ delta: { tool_calls: toolCalls } }] };
              return;
            }
            yield { choices: [{ delta: { content: '已核验新行情，BTC目前112，压力位尚未收复。' + '核验证据。'.repeat(320) } }] };
          } } } } };
        },
      },
      './follow-up-domains': domain,
      './space-message-runtime': { prepareSpaceMessageRuntime: async () => ({ promptContext: 'confirmed state', agentPolicy: () => '' }) },
      '../agents/memory/current-time-context.mjs': { currentTimeContext: () => 'current time' },
      '../agents/runtime/tool-loop.mjs': toolLoop,
      '../capabilities/registry.mjs': { getReadOnlyExternalCapabilityIds: () => ['crypto_market'] },
      '../web/auto-web': { createChatWebTools: () => ({ tools: [], guidance: 'read only', footer: () => '', attachments: () => [] }) },
    });
    const result = await generate.generateSpaceFollowUp(task);
    assert.match(result.content, /BTC目前112/);
    assert.match(result.content, /未取得可靠的 1H 比较窗口/);
    assert.equal(modelCalls, 1);
    for (const max of [6, 0]) {
      queries = 0; modelCalls = 0; expectedMax = max;
      await generate.generateSpaceFollowUp({ ...task, maxChainDepth: max });
      assert.equal(modelCalls, 1);
    }
    expectedMax = 3;
    marketAvailable = false;
    await assert.rejects(() => generate.generateSpaceFollowUp(task), /未取得 BTC 的可靠新行情/);
    assert.equal(modelCalls, 1, 'missing fresh data must not become a model-generated current price');
    marketAvailable = true; proposeNext = true; queries = 0; modelCalls = 0;
    oiWindow = { from: '2026-11-15T02:00:00Z', to: '2026-11-15T03:00:00Z', period: '1H', scope: 'OKX_CURRENCY_CONTRACTS', ccy: 'BTC' };
    await f.bindQQ(); await f.patch('b', { qqEnabled: true }); proposeNotice = true;
    const continued = await generate.generateSpaceFollowUp(task);
    assert.match(continued.content, /OI 统计依据：OKX BTC 币种合约统计，.*10:00.*11:00.*变化 2\.82%；本轮采集 .*12:05/s);
    assert.equal(modelCalls, 2);
    assert.equal(continued.nextFollowUp.runAt.toISOString(), nextRunAt);
    assert.equal(await f.db.spaceFollowUp.count(), 1, 'the model only stages a continuation until its report is committed');
    assert.equal(await f.db.assistantReminder.count(), 0, 'notification tool stages a proposal without sending or queueing it during reasoning');
    assert.equal(continued.qqNotification.eventKey, importantNotice.eventKey);
    await f.service.runSpaceFollowUpTick({ db: f.db, now: f.due, generate: async () => continued });
    const child = await f.db.spaceFollowUp.findUnique({ where: { parentId: task.id } });
    assert.equal(child.origin, 'AI_FOLLOW_UP');
    assert.equal(child.runAt.toISOString(), nextRunAt);
    assert.match(child.context, /OI 统计依据：OKX BTC 币种合约统计，.*10:00.*11:00/s, 'window evidence survives even when the report exceeds the chat-context truncation limit');
    assert.match((await f.db.spaceMessage.findFirst()).content, /下次自主复查/);
    assert.equal(await f.db.assistantReminder.count(), 1, 'notification is queued only when the analysis is committed');
  } finally { await f.close(); }
});
