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
import { PERSONAL_REMINDER_FILTER } from '../personal-assistant/reminder-scope.mjs';

test('space message API paginates timestamp ties without gaps, reports exact exhaustion and checks access', async () => {
  const root = new URL('../../', import.meta.url);
  const folder = await mkdtemp(path.join(tmpdir(), 'almaren-message-pages-'));
  const file = path.join(folder, 'test.db');
  const raw = new Database(file);
  const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) });
  try {
    for (const migration of (await readdir(new URL('prisma/migrations/', root))).filter(name => /^\d/.test(name)).sort()) {
      raw.exec(await readFile(new URL(`prisma/migrations/${migration}/migration.sql`, root), 'utf8'));
    }
    await db.user.create({ data: { id: 'owner', email: 'owner@test.local', name: 'owner', passwordHash: 'fixture' } });
    await db.space.create({ data: { id: 'space', userId: 'owner', name: 'space' } });
    await db.spaceMessage.createMany({ data: Array.from({ length: 65 }, (_, index) => ({
      id: String(index).padStart(3, '0'), spaceId: 'space', role: 'user', content: `message ${index}`,
      createdAt: new Date('2026-11-16T06:00:00Z'),
    })) });
    const exports = {};
    const imports = {
      'next/server': { NextResponse: { json: (data, options) => Response.json(data, options) } },
      '@/app/api/_lib/db': { default: db },
      '@/app/api/_lib/auth': { requireAuth(request) { const user = request.headers.get('x-user'); if (!user) throw Error('Unauthorized'); return user; } },
      '@/app/api/_lib/spaces': { getSpaceForUser: (id, userId) => db.space.findFirst({ where: { id, userId } }) },
    };
    const source = await readFile(new URL('app/api/spaces/[spaceId]/messages/route.ts', root), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { exports, URL, Date, console, Set, Map, process, require: name => imports[name] || {} });
    const get = (query = '', user = 'owner') => exports.GET(new Request(`http://localhost/messages?${query}`, { headers: user ? { 'x-user': user } : {} }), { params: Promise.resolve({ spaceId: 'space' }) });
    let cursor = '', all = [];
    for (const expected of [true, true, true, false]) {
      const response = await get(`limit=20${cursor}`);
      assert.equal(response.status, 200);
      const page = await response.json();
      assert.equal(page.hasMore, expected);
      all = [...page.messages, ...all];
      const oldest = page.messages[0];
      cursor = `&before=${encodeURIComponent(oldest.createdAt)}&beforeId=${oldest.id}`;
    }
    assert.deepEqual(all.map(message => message.id), Array.from({ length: 65 }, (_, index) => String(index).padStart(3, '0')));
    const exact = await (await get('limit=65')).json();
    assert.equal(exact.hasMore, false);
    assert.equal((await get('', 'other')).status, 404);
    assert.equal((await get('', '')).status, 401);
    for (const query of ['limit=0', 'limit=NaN', 'before=invalid', 'beforeId=001']) assert.equal((await get(query)).status, 400);

    await db.user.create({ data: { id: 'other', email: 'other@test.local', name: 'other', passwordHash: 'fixture' } });
    await db.conversation.createMany({ data: [
      { id: 'main', userId: 'owner', kind: 'PERSONAL_ASSISTANT', assistantMode: 'MAIN' },
      { id: 'temporary', userId: 'owner', kind: 'PERSONAL_ASSISTANT', assistantMode: 'TEMPORARY' },
      { id: 'agent', userId: 'owner', kind: 'AGENT' },
      { id: 'foreign', userId: 'other', kind: 'PERSONAL_ASSISTANT' },
    ] });
    for (const conversationId of ['main', 'temporary']) await db.message.createMany({ data: Array.from({ length: 65 }, (_, index) => ({
      id: `${conversationId}-${String(index).padStart(3, '0')}`, conversationId, role: 'user', content: `message ${index}`,
      createdAt: new Date('2026-11-16T06:00:00Z'),
    })) });
    const profile = { conversationId: 'main', name: '小伴' };
    const assistantImports = { ...imports,
      '@/lib/personal-assistant/profile': { ensurePersonalAssistant: async () => profile },
      '@/lib/personal-assistant/reminder-scope.mjs': { PERSONAL_REMINDER_FILTER },
    };
    const load = async route => {
      const exports = {};
      vm.runInNewContext(ts.transpileModule(await readFile(new URL(route, root), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText, { exports, URL, Date, require: name => assistantImports[name] || {} });
      return exports;
    };
    const routes = await load('app/api/assistant/conversations/[conversationId]/route.ts');
    const invoke = (method, conversationId, query = '', user = 'owner') => routes[method](new Request(`http://localhost/conversation?${query}`, {
      method, headers: user ? { 'x-user': user } : {},
    }), { params: Promise.resolve({ conversationId }) });
    for (const id of ['main', 'temporary']) {
      const first = await (await invoke('GET', id)).json();
      assert.equal(first.messages.length, 60); assert.equal(first.hasMore, true);
      const oldest = first.messages[0];
      const last = await (await invoke('GET', id, `before=${oldest.createdAt}&beforeId=${oldest.id}`)).json();
      assert.equal(last.messages.length, 5); assert.equal(last.hasMore, false);
      assert.equal(new Set([...last.messages, ...first.messages].map(row => row.id)).size, 65);
      const switched = await (await invoke('POST', id)).json();
      assert.equal(switched.conversationMode, id === 'main' ? 'MAIN' : 'TEMPORARY');
      assert.equal(switched.hasMore, true); assert.equal(switched.messages.length, 60);
    }
    for (const id of ['agent', 'foreign', 'missing']) assert.equal((await invoke('GET', id)).status, 404);
    assert.equal((await invoke('GET', 'main', '', '')).status, 401);
    for (const query of ['before=invalid', 'limit=0', 'beforeId=test']) assert.equal((await invoke('GET', 'main', query)).status, 400);
    const bootstrap = await load('app/api/assistant/route.ts');
    const initial = await (await bootstrap.GET(new Request('http://localhost/assistant', { headers: { 'x-user': 'owner' } }))).json();
    assert.equal(initial.messages.length, 60); assert.equal(initial.hasMore, true);
    const deleted = await (await invoke('DELETE', 'temporary')).json();
    assert.equal(deleted.currentConversationId, 'main'); assert.equal(deleted.messages.length, 60); assert.equal(deleted.hasMore, true);
  } finally { raw.close(); await db.$disconnect(); await rm(folder, { recursive: true, force: true }); }
});
