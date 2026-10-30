import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

async function load(relativePath, require) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, { exports, require, URL, Number });
  return exports;
}

test('run query scopes new events in the database and preserves full-history callers', async () => {
  const queries = [];
  const { getAgentRunForUser } = await load('../../app/api/_lib/agent-runs.ts', () => ({ agentRun: { findFirst: async (query) => { queries.push(query); return {}; } } }));
  await getAgentRunForUser('r', 'u', 500);
  const query = queries[0];
  assert.equal(query.where.id, 'r');
  assert.equal(query.where.userId, 'u');
  assert.equal(query.include.events.where.sequence.gt, 500);
  assert.equal(query.include.events.orderBy.sequence, 'asc');
  await getAgentRunForUser('r', 'u');
  assert.equal(queries[1].include.events.where, undefined);
});

test('run route rejects invalid cursors before querying and passes valid cursor through', async () => {
  const cursors = [];
  const { GET } = await load('../../app/api/runs/[runId]/route.ts', (name) => {
    if (name === 'next/server') return { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } };
    if (name.endsWith('/auth')) return { requireAuth: () => 'u' };
    return { getAgentRunForUser: async (_runId, _userId, cursor) => { cursors.push(cursor); return { events: [], id: 'r' }; } };
  });
  for (const cursor of ['NaN', 'Infinity', '-1', '1.5']) {
    const result = await GET({ url: `http://local/api/runs/r?afterSequence=${cursor}` }, { params: Promise.resolve({ runId: 'r' }) });
    assert.equal(result.status, 400);
  }
  assert.equal(cursors.length, 0);
  const result = await GET({ url: 'http://local/api/runs/r?afterSequence=500' }, { params: Promise.resolve({ runId: 'r' }) });
  assert.equal(result.status, 200);
  assert.deepEqual(cursors, [500]);
});
