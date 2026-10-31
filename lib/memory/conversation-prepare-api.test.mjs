import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source = await readFile(new URL('../../app/api/conversations/[conversationId]/context/prepare/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function fixture() {
  const state = { authenticated: true, owned: true, calls: [], latest: { id: 'current', role: 'user', content: '继续' } };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require(name) {
    if (name === 'next/server') return { NextResponse: { json: Response.json } };
    if (name.endsWith('/auth')) return { requireAuth: () => { if (!state.authenticated) throw Error('Unauthorized'); return 'owner'; } };
    if (name.endsWith('/agent-personal-memory')) return { requireAgentMemoryAccess: async (userId, agentId) => { assert.equal(userId, 'owner'); assert.equal(agentId, 'a'); } };
    if (name.endsWith('/db')) return { default: {
      conversation: { findFirst: async ({ where }) => { assert.equal(where.userId, 'owner'); assert.equal(where.id, 'c'); assert.equal(where.kind, 'AGENT'); return state.owned ? { agentId: 'a', contextMessageLimit: 40 } : null; } },
      message: { findFirst: async ({ where }) => { assert.equal(where.conversationId, 'c'); return state.latest; } },
      user: { findUnique: async () => ({ modelContextWindow: 32768, contextMessageLimit: 40 }) },
    } };
    if (name.endsWith('/conversation-context')) return { prepareConversationContext: async options => { state.calls.push(options); return { messages: [{ role: 'user', content: '继续' }], manifest: { recentCount: 12 } }; } };
    throw Error(name);
  } });
  return { state, post: body => exports.POST({ json: async () => body }, { params: Promise.resolve({ conversationId: 'c' }) }) };
}
test('browser preparation uses route ownership and never requests a server model', async () => {
  const f = fixture();
  const response = await f.post({ requiredSystem: '角色与时间', currentContent: '继续', optional: [], maxMessages: 12, userId: 'foreign', conversationId: 'foreign' });
  assert.equal(response.status, 200);
  assert.equal(f.state.calls[0].userId, 'owner');
  assert.equal(f.state.calls[0].conversationId, 'c');
  assert.equal(f.state.calls[0].maxMessages, 12);
  assert.equal(f.state.calls[0].summarize, undefined);
  assert.equal((await response.json()).contextManifest.recentCount, 12);
  assert.doesNotMatch(source, /createModelClient|apiKey|completions\.create/);
});
test('browser preparation rejects unauthorized, foreign and malformed requests', async () => {
  const f = fixture();
  f.state.authenticated = false;
  assert.equal((await f.post({})).status, 401);
  f.state.authenticated = true;
  f.state.owned = false;
  assert.equal((await f.post({})).status, 404);
  f.state.owned = true;
  assert.equal((await f.post({ requiredSystem: '', currentContent: null })).status, 400);
  assert.equal(f.state.calls.length, 0);
});


test('browser retries reuse only a verified current user ID, including image-only messages', async () => {
  const f = fixture();
  const body = { requiredSystem: '', currentContent: '继续', optional: [] };
  assert.equal((await f.post({ ...body, currentMessageId: 'current' })).status, 200);
  assert.deepEqual([...f.state.calls[0].excludeMessageIds], ['current']);
  assert.equal((await f.post({ ...body, currentMessageId: 'foreign' })).status, 409);
  f.state.latest.content = '';
  assert.equal((await f.post({ ...body, reuseLastUserMessage: true, currentContent: [{ type: 'text', text: '请分析图片' }, { type: 'image_url', image_url: { url: 'data:example' } }] })).status, 200);
  assert.deepEqual([...f.state.calls.at(-1).excludeMessageIds], ['current']);
  f.state.latest.role = 'assistant';
  assert.equal((await f.post({ ...body, currentMessageId: 'current' })).status, 409);
});
