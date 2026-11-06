import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as update from './personal-memory-update.mjs';

for (const kind of ['assistant', 'agent']) {
  test(`${kind} rule editing enforces confirmation, ownership, revision history and rollback`, async () => {
    const records = [{ id: 'rule', userId: 'owner', agentId: 'a', status: 'DISABLED', trustStatus: 'VERIFIED', category: 'rule', content: '旧约定', factKey: '约定', updatedAt: 1 }];
    let failUpdate = false;
    const matches = (item, where) => Object.entries(where).every(([key, value]) => item[key] === value);
    const store = {
      findFirst: async ({ where }) => records.find(item => matches(item, where)),
      create: async ({ data }) => { const item = { id: `new-${records.length}`, updatedAt: records.length + 1, ...data }; records.push(item); return item; },
      updateMany: async ({ where, data }) => {
        const item = records.find(item => matches(item, where));
        if (failUpdate || !item) return { count: 0 };
        Object.assign(item, data, { updatedAt: item.updatedAt + 1 }); return { count: 1 };
      },
    };
    const db = { $transaction: async callback => {
      const before = structuredClone(records);
      try { return await callback({ [`${kind}MemoryItem`]: store }); }
      catch (error) { records.splice(0, records.length, ...before); throw error; }
    } };
    const root = kind === 'agent' ? 'agents/[agentId]' : 'assistant';
    const source = await readFile(new URL(`../../app/api/${root}/memories/[memoryId]/route.ts`, import.meta.url), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    const modules = {
      'next/server': { NextResponse: { json: Response.json } },
      '@/app/api/_lib/db': { default: db }, '@/app/api/_lib/auth': { requireAuth: () => 'owner' },
      '@/app/api/_lib/agent-personal-memory': { requireAgentMemoryAccess: async () => {} },
      '@/lib/memory/personal-memory-update.mjs': update,
    };
    vm.runInNewContext(output, { exports, require: name => { assert.ok(name in modules); return modules[name]; } });
    const patch = (id, body) => exports.PATCH({ json: async () => body }, { params: Promise.resolve({ agentId: 'a', memoryId: id }) });
    assert.equal((await patch('rule', { content: '不能借编辑启用', status: 'ACTIVE' })).status, 400);
    assert.equal(records.length, 1);
    const edited = await patch('rule', { content: '新约定' });
    assert.equal(edited.status, 200);
    const replacement = (await edited.json()).memory;
    assert.equal(replacement.status, 'DISABLED');
    assert.equal(replacement.factKey, '约定');
    assert.equal(records[0].content, '旧约定');
    assert.equal(records[0].supersededById, replacement.id);
    for (const body of [{ status: 'ACTIVE' }, { content: '覆盖旧约定' }]) assert.equal((await patch('rule', body)).status, 400);
    assert.equal((await patch(replacement.id, { content: '新约定' })).status, 200);
    assert.equal(records.length, 2);
    assert.equal((await patch(replacement.id, { status: 'ACTIVE' })).status, 200);
    assert.equal(records[1].status, 'ACTIVE');
    failUpdate = true;
    assert.equal((await patch(replacement.id, { content: '冲突修改' })).status, 409);
    assert.equal(records.length, 2);
    assert.equal(records[1].status, 'ACTIVE');
    failUpdate = false;
    for (const status of ['PENDING_QQ', 'DISPUTED', 'SUPERSEDED']) {
      records.push({ ...records[0], id: status, status });
      assert.equal((await patch(status, { status: 'ACTIVE' })).status, 400);
    }
    records.push({ ...records[0], id: 'foreign', userId: 'other' });
    assert.equal((await patch('foreign', { content: '不能写入' })).status, 404);
    if (kind === 'agent') {
      records.push({ ...records[0], id: 'foreign-agent', agentId: 'b' });
      assert.equal((await patch('foreign-agent', { content: '不能写入' })).status, 404);
    }
    for (const body of [{ status: 'UNKNOWN' }, { content: ' ' }, { content: '字'.repeat(501) }, { category: 'plan' }]) {
      assert.equal((await patch(replacement.id, body)).status, 400);
    }
  });
}
