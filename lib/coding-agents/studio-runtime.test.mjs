import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, mkdir, writeFile, rename, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import ts from 'typescript';
import { loadSkills } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js';
import { resolveAgentModelConfig } from '../agents/model/agent-model-config.mjs';

const nativeRequire = createRequire(import.meta.url);
async function load(file, mocks = {}) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, process, Buffer, console, Response, TextEncoder, ReadableStream, URL, AbortController,
    setTimeout, clearTimeout, setInterval, clearInterval,
    require: (name) => name in mocks
      ? ('default' in mocks[name] ? { __esModule: true, ...mocks[name] } : mocks[name])
      : nativeRequire(name),
  });
  return exports;
}
const safePath = await load('./safe-path.ts');
const workspaceSkills = await load('./workspace-skills.ts', { './safe-path': safePath });
const settings = await load('./runtime-settings.ts', { './workspace-skills': workspaceSkills });
const operations = await load('./conversation-operations.ts');

test('context usage includes cache tokens and reports finite remaining context', () => {
  const usage = settings.contextUsage({ input: 20, output: 10, cacheRead: 70, cacheWrite: 5, totalTokens: 30 }, 100);
  assert.equal(usage.totalTokens, 105);
  assert.equal(usage.remainingTokens, 0);
  assert.equal(usage.contextLength, 100);
  assert.equal(settings.contextUsage({}, 100), null);
});

test('skill loading follows enabled files, content edits and removal', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-skills-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspaceDir = path.join(root, 'workspace');
  await mkdir(workspaceDir);
  const dir = path.join(root, '.pi_agent/skills/demo');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), '---\nname: demo\ndescription: demo skill\n---\nOriginal');
  const first = await settings.readWorkspaceSkills(workspaceDir);
  assert.equal(first.length, 1);
  assert.equal(first[0].path, `${workspaceSkills.PI_CONFIG_SKILL_PREFIX}demo/SKILL.md`);
  const loaded = loadSkills({ cwd: workspaceDir, agentDir: path.join(root, '.pi_agent'), skillPaths: [path.join(dir, 'SKILL.md')], includeDefaults: false });
  assert.equal(loaded.skills.length, 1);
  assert.equal(loaded.skills[0].name, 'demo');
  await writeFile(path.join(dir, 'SKILL.md'), 'Changed');
  assert.notEqual((await settings.readWorkspaceSkills(workspaceDir))[0].digest, first[0].digest);
  await rename(path.join(dir, 'SKILL.md'), path.join(dir, 'SKILL.md.disabled'));
  assert.equal((await settings.readWorkspaceSkills(workspaceDir)).length, 0);
});

async function runtimeFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-runtime-'));
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  const children = [], launches = [];
  const module = await load('./pi-runtime.ts', {
    './sandbox': { resolveStudioWorkspace: async () => workspace },
    './runtime-settings': settings,
    '../core/model-client': { DEFAULT_MODEL: 'default', DEFAULT_BASE_URL: 'https://default' },
    './pi-launch': { PI_SESSION_PLACEHOLDER: '__SESSION__', buildPiLaunchSpec: async (options) => {
      launches.push(options);
      return { kind: 'host', command: 'mock', args: [], cwd: workspace, env: {} };
    } },
    './sandbox/docker-driver': { removeSandboxEnvFile: async () => {} },
    './approval-store': { approvalStore: {} },
    './secret-redaction': { redactSecrets: (text) => text },
    'node:child_process': { spawn: () => {
      const child = new EventEmitter();
      child.exitCode = null;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.commands = [];
      child.stdin.write = (line) => child.commands.push(JSON.parse(line));
      child.stdin.end = () => {};
      child.kill = () => { child.exitCode = 0; child.emit('close', 0); };
      children.push(child);
      return child;
    } },
  });
  const runtime = new module.PiStudioRuntime();
  t.after(async () => { await runtime.stopRuntime('u:w'); await rm(root, { recursive: true, force: true }); });
  const events = [];
  const base = { userId: 'u', workspaceId: 'w', runId: 'r', message: 'hello', apiKey: 'key', onEvent: (event) => events.push(event) };
  async function start(extra = {}) {
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const turn = runtime.runTurn({ ...base, ...extra, onEvent(event) {
      events.push(event);
      if (event.type === 'run.started') started();
    } });
    await Promise.race([ready, turn.then(() => { throw Error('No run.started'); })]);
    return { turn, child: children.at(-1) };
  }
  function end(child) { child.stdout.emit('data', Buffer.from('{"type":"agent_settled"}\n')); }
  return { root, workspace, runtime, base, launches, children, events, start, end };
}

test('runtime reuses unchanged config and restarts for credentials, endpoint, approval and skills', async (t) => {
  const f = await runtimeFixture(t);
  let current = await f.start(); f.end(current.child); await current.turn;
  current = await f.start(); f.end(current.child); await current.turn;
  assert.equal(f.children.length, 1);
  const sessionFile = path.join(f.root, 'sessions/u-w.jsonl');
  await mkdir(path.dirname(sessionFile), { recursive: true });
  await writeFile(sessionFile, 'preserved session');
  let config = {};
  for (const extra of [{ apiKey: 'new-key' }, { apiBaseUrl: 'https://new' }, { approvalMode: 'never' }, { modelName: 'new-model' }, { modelContextWindow: 4096 }]) {
    config = { ...config, ...extra };
    const before = f.children.length;
    current = await f.start(config); f.end(current.child); await current.turn;
    assert.equal(f.children.length, before + 1);
    assert.equal(await readFile(sessionFile, 'utf8'), 'preserved session');
  }
  const dir = path.join(f.root, '.pi_agent/skills/demo');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), 'skill');
  current = await f.start(config); f.end(current.child); await current.turn;
  assert.ok(f.launches.at(-1).agentArgs.includes(`${workspaceSkills.PI_CONFIG_SKILL_PREFIX}demo/SKILL.md`));
  const beforeDisable = f.children.length;
  await rename(path.join(dir, 'SKILL.md'), path.join(dir, 'SKILL.md.disabled'));
  current = await f.start(config); f.end(current.child); await current.turn;
  assert.equal(f.children.length, beforeDisable + 1);
  assert.ok(!f.launches.at(-1).agentArgs.includes('--skill'));
});

test('concurrent requests cannot reset or replace an active runtime, including startup', async (t) => {
  const f = await runtimeFixture(t);
  const first = f.runtime.runTurn(f.base);
  await assert.rejects(f.runtime.runTurn({ ...f.base, resetSession: true }), /仍在执行/);
  // Startup has asynchronous filesystem steps; wait for the explicit event.
  while (!f.events.some(e => e.type === 'run.started')) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.runtime.runTurn({ ...f.base, approvalMode: 'never' }), /仍在执行/);
  assert.equal(f.children.length, 1);
  f.children[0].stdout.emit('data', Buffer.from(JSON.stringify({ type: 'message_end', message: {
    role: 'assistant', usage: { input: 10, output: 5, cacheRead: 100 },
  } }) + '\n'));
  assert.equal(f.events.find(e => e.type === 'usage.updated').data.totalTokens, 115);
  f.end(f.children[0]); await first;
});

test('chat refuses a foreign workspace before persistence or runtime execution', async () => {
  let writes = 0, runs = 0;
  const route = await load('../../app/api/studio/chat/route.ts', {
    '@/app/api/_lib/db': { default: {
      studioWorkspace: { findFirst: async ({ where }) => { assert.equal(where.userId, 'u'); assert.equal(where.id, 'foreign'); return null; } },
      studioMessage: { create: async () => { writes++; } },
    } },
    '@/app/api/_lib/auth': { requireAuth: () => 'u' },
    '@/app/api/_lib/agent-model': { resolveUserModelConfig: () => ({}) },
    '@/lib/coding-agents/pi-runtime': { runStudioPiTurn: async () => { runs++; } },
    '@/lib/coding-agents/conversation-operations': operations,
    '@/lib/coding-agents/approval-store': { approvalStore: {} },
  });
  const response = await route.POST({ json: async () => ({ message: 'hello', workspaceId: 'foreign' }) });
  assert.equal(response.status, 404);
  assert.equal(writes, 0); assert.equal(runs, 0);
});

test('message reload uses latest context usage rather than total historical consumption', async () => {
  const route = await load('../../app/api/studio/workspaces/[workspaceId]/messages/route.ts', {
    'next/server': { NextResponse: { json: Response.json } },
    '@/app/api/_lib/auth': { requireAuth: () => 'u' },
    '@/app/api/_lib/db': { default: {
      studioWorkspace: { findFirst: async () => ({ id: 'w' }) },
      studioMessage: {
        findFirst: async ({ where, orderBy }) => { assert.equal(where.role, 'assistant'); assert.equal(orderBy.createdAt, 'desc'); return { tokens: 123 }; },
        count: async () => 2,
        findMany: async () => [{ tokens: 100 }, { tokens: 123 }],
      },
    } },
    '@/lib/coding-agents/pi-runtime': {},
    '@/lib/coding-agents/conversation-operations': operations,
  });
  const response = await route.GET(new Request('http://localhost?all=true'), { params: Promise.resolve({ workspaceId: 'w' }) });
  assert.equal((await response.json()).totalTokens, 123);
});

test('chat passes enabled account settings or system defaults to runtime and persists zero usage', async () => {
  const user = { customModelEnabled: true, apiKey: 'account-key', apiBaseUrl: 'https://account', modelName: 'account-model', modelContextWindow: 8192 };
  const runs = [], saved = [];
  const resolver = await load('../../app/api/_lib/agent-model.ts', {
    '@/app/api/_lib/db': { default: {} },
    '@/lib/core/model-client': { DEFAULT_BASE_URL: 'https://system', DEFAULT_MODEL: 'system-model' },
    '@/lib/agents/model/agent-model-config.mjs': { resolveAgentModelConfig },
  });
  const route = await load('../../app/api/studio/chat/route.ts', {
    '@/app/api/_lib/db': { default: {
      studioWorkspace: { findFirst: async () => ({ systemPrompt: 'workspace rules' }) },
      studioMessage: { findMany: async () => [], create: async ({ data }) => { saved.push(data); } },
      user: { findUnique: async () => user },
    } },
    '@/app/api/_lib/auth': { requireAuth: () => 'u' },
    '@/app/api/_lib/agent-model': resolver,
    '@/lib/coding-agents/conversation-operations': operations,
    '@/lib/coding-agents/pi-runtime': { runStudioPiTurn: async (options) => {
      runs.push(options);
      options.onEvent({ type: 'message.delta', data: { delta: 'hello' } });
      options.onEvent({ type: 'usage.updated', data: { totalTokens: 0, contextLength: 8192, remainingTokens: 8192 } });
    } },
    '@/lib/coding-agents/approval-store': { approvalStore: { cancelAllByRun() {} } },
  });
  const send = async () => {
    const response = await route.POST({ json: async () => ({ message: 'hello', workspaceId: 'w', approvalMode: 'always' }) });
    assert.equal(response.status, 200);
    await response.text();
    return runs.at(-1);
  };
  let options = await send();
  assert.equal(options.apiKey, 'account-key');
  assert.equal(options.apiBaseUrl, 'https://account');
  assert.equal(options.modelName, 'account-model');
  assert.equal(options.approvalMode, 'always');
  assert.equal(options.workspaceSystemPrompt, 'workspace rules');
  assert.equal(options.modelContextWindow, 8192);
  assert.equal(saved.at(-1).tokens, 0);
  user.customModelEnabled = false;
  options = await send();
  assert.equal(options.apiBaseUrl, process.env.OPENAI_BASE_URL || 'https://system');
  assert.equal(options.modelName, 'system-model');
  assert.notEqual(options.apiKey, 'account-key');
});

test('launcher isolates model config per workspace and forwards context and approval settings', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-launch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const launcher = await load('./pi-launch.ts', {
    './workspace-skills': workspaceSkills,
    './sandbox': { buildSanitizedEnv: () => ({}) },
    './sandbox/docker-args': {},
    './sandbox/docker-driver': {},
    './sandbox/policy': { resolveSandboxMode: () => 'host' },
    '../core/model-client': { DEFAULT_MODEL: 'default', DEFAULT_BASE_URL: 'https://default' },
  });
  const launch = async (id, model) => launcher.buildPiLaunchSpec({
    userId: 'same-user', sessionId: id, workspaceDir: path.join(root, id, 'workspace'),
    agentArgs: ['--session', launcher.PI_SESSION_PLACEHOLDER],
    customApiKey: 'secret-key', customBaseUrl: 'https://example.com/v1',
    modelName: model, modelContextWindow: 8192, approvalMode: 'always',
  });
  const first = await launch('one', 'first-model');
  const second = await launch('two', 'second-model');
  assert.notEqual(first.env.PI_CODING_AGENT_DIR, second.env.PI_CODING_AGENT_DIR);
  const json = await readFile(path.join(first.env.PI_CODING_AGENT_DIR, 'models.json'), 'utf8');
  const provider = JSON.parse(json).providers.custom;
  assert.equal(provider.models[0].id, 'first-model');
  assert.equal(provider.models[0].contextWindow, 8192);
  assert.equal(provider.baseUrl, 'https://example.com/v1');
  assert.ok(!json.includes('secret-key'));
  assert.equal(first.env.STUDIO_APPROVAL_MODE, 'always');
  assert.equal(first.env.STUDIO_MODEL_API_KEY, 'secret-key');
});

async function until(predicate) {
  for (let i = 0; i < 2000; i++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw Error('Expected state was not reached');
}

async function conversationFixture(t) {
  const f = await runtimeFixture(t);
  const rows = [], runs = [];
  let beforeSave = async () => {};
  const matches = (row, where) => Object.entries(where).every(([key, value]) =>
    value && typeof value === 'object' && 'in' in value ? value.in.includes(row[key]) : row[key] === value);
  const db = {
    studioWorkspace: { findFirst: async ({ where }) => where.userId === 'u' && where.id === 'w' ? { systemPrompt: '' } : null },
    user: { findUnique: async () => ({ modelContextWindow: 8192 }) },
    studioMessage: {
      findMany: async ({ where }) => rows.filter(row => matches(row, where)).sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
      findFirst: async ({ where }) => rows.find(row => matches(row, where)),
      create: async ({ data }) => { await beforeSave(data); assert.ok(!rows.some(row => row.id === data.id)); rows.push(data); return data; },
      deleteMany: async ({ where }) => { for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1); },
      updateMany: async ({ where, data }) => { rows.filter(row => matches(row, where)).forEach(row => Object.assign(row, data)); },
    },
  };
  const mocks = {
    '@/app/api/_lib/db': { default: db },
    '@/app/api/_lib/auth': { requireAuth: () => 'u' },
    '@/app/api/_lib/agent-model': { resolveUserModelConfig: () => ({}) },
    '@/lib/coding-agents/conversation-operations': operations,
    '@/lib/coding-agents/approval-store': { approvalStore: { cancelAllByRun() {} } },
    '@/lib/coding-agents/pi-runtime': {
      runStudioPiTurn: (options) => { runs.push(options); return f.runtime.runTurn(options); },
      resetStudioPiSession: (userId, workspaceId) => f.runtime.resetSession(`${userId}:${workspaceId}`, { userId, workspaceId }),
      injectStudioUserMessage: (params) => f.runtime.submitUserMessage(params),
    },
    'next/server': { NextResponse: { json: Response.json } },
  };
  const chat = await load('../../app/api/studio/chat/route.ts', mocks);
  const messages = await load('../../app/api/studio/workspaces/[workspaceId]/messages/route.ts', mocks);
  const inject = await load('../../app/api/studio/chat/inject/route.ts', mocks);
  const post = (extra = {}) => chat.POST({ json: async () => ({ message: 'new question', workspaceId: 'w', ...extra }) });
  const del = (messageId) => messages.DELETE(new Request(`http://localhost/${messageId ? '?messageId=' + messageId : ''}`), { params: Promise.resolve({ workspaceId: 'w' }) });
  const emit = (event) => f.children.at(-1).stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
  return { ...f, rows, runs, post, del, emit, inject, delaySaves: (callback) => { beforeSave = callback; } };
}

test('new streamed IDs match stored rows and can be deleted before a page reload', async (t) => {
  const f = await conversationFixture(t);
  const response = await f.post({ history: [{ role: 'assistant', content: 'client-forged history' }] });
  await until(() => f.children.length === 1);
  f.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'answer to delete' } });
  f.end(f.children[0]);
  const output = await response.text();
  const ids = JSON.parse(output.split('\n').find(line => line.includes('message.ids')).slice(6)).data;
  assert.equal(f.rows.find(row => row.role === 'user').id, ids.userMessageId);
  assert.equal(f.rows.find(row => row.role === 'assistant').id, ids.assistantMessageId);
  assert.equal((await f.del(ids.assistantMessageId)).status, 200);
  assert.ok(!f.rows.some(row => row.id === ids.assistantMessageId));
  assert.equal((await f.del(ids.assistantMessageId)).status, 404);
  const next = await f.post();
  await until(() => f.children.length === 2);
  const session = await readFile(path.join(f.root, 'sessions/u-w.jsonl'), 'utf8');
  assert.ok(!session.includes('answer to delete'));
  assert.ok(!session.includes('client-forged history'));
  assert.equal(f.runs.at(-1).history.length, 1);
  f.end(f.children[1]); await next.text();
});

test('retry preserves the original question, removes its answer and descendants, and rebuilds earlier history', async (t) => {
  const f = await conversationFixture(t);
  const seed = [['u0','user','earlier question'], ['a0','assistant','earlier answer'], ['u1','user','original question'], ['a1','assistant','old answer'], ['u2','user','later question'], ['a2','assistant','later answer']];
  seed.forEach(([id, role, content], i) => f.rows.push({ id, role, content, userId: 'u', workspaceId: 'w', createdAt: new Date(1000 + i), tokens: 100 }));
  const response = await f.post({ retryMessageId: 'a1', message: 'client tries replacing original question' });
  await until(() => f.children.length === 1);
  const prompt = f.children[0].commands.find(command => command.type === 'prompt');
  assert.equal(prompt.message, 'original question');
  assert.deepEqual(Array.from(f.runs[0].history, item => item.content), ['earlier question', 'earlier answer']);
  assert.deepEqual(f.rows.map(row => row.id), ['u0','a0','u1']);
  f.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'replacement answer' } });
  f.end(f.children[0]);
  const output = await response.text();
  const ids = JSON.parse(output.split('\n').find(line => line.includes('message.ids')).slice(6)).data;
  assert.equal(ids.userMessageId, 'u1');
  assert.equal(f.rows.filter(row => row.id === 'u1').length, 1);
  assert.equal(f.rows.at(-1).content, 'replacement answer');
  const session = await readFile(path.join(f.root, 'sessions/u-w.jsonl'), 'utf8');
  assert.ok(session.includes('earlier answer'));
  assert.ok(!session.includes('old answer'));
  assert.ok(!session.includes('later question'));
});

test('clearing aborts the active run, waits for its last write, and removes its session without deleting files', async (t) => {
  const f = await conversationFixture(t);
  await writeFile(path.join(f.workspace, 'keep.md'), 'keep this file');
  const response = await f.post();
  await until(() => f.children.length === 1);
  let releaseSave;
  const saveGate = new Promise(resolve => { releaseSave = resolve; });
  let saving = false;
  f.delaySaves(async (data) => { if (data.role === 'assistant') { saving = true; await saveGate; } });
  let cleared = false;
  const clearing = f.del().then(response => { cleared = true; return response; });
  await until(() => f.runs[0].signal.aborted);
  assert.equal((await f.post()).status, 409);
  f.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'late output' } });
  f.end(f.children[0]);
  await until(() => saving);
  assert.equal(cleared, false);
  releaseSave();
  assert.equal((await clearing).status, 200);
  await response.text();
  assert.equal(f.rows.length, 0);
  await assert.rejects(readFile(path.join(f.root, 'sessions/u-w.jsonl')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(f.workspace, 'keep.md'), 'utf8'), 'keep this file');
});

test('injected messages use stable IDs and persist in the same ordered request as assistant segments', async (t) => {
  const f = await conversationFixture(t);
  const response = await f.post();
  await until(() => f.children.length === 1);
  f.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'first segment' } });
  const injected = await f.inject.POST({ json: async () => ({ workspaceId: 'w', message: 'injected question' }) });
  assert.equal(injected.status, 200);
  f.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'second segment' } });
  f.end(f.children[0]);
  const output = await response.text();
  const event = JSON.parse(output.split('\n').find(line => line.includes('user.message_injected')).slice(6));
  assert.deepEqual(f.rows.map(row => row.content), ['new question','first segment','injected question','second segment']);
  assert.equal(f.rows[2].id, event.data.userMessageId);
  assert.equal(f.rows[3].id, event.data.assistantMessageId);
  assert.ok(f.rows.every((row, i) => i === 0 || row.createdAt > f.rows[i-1].createdAt));
});

test('skills installed in the Pi config directory appear in the library and obey toggle and uninstall', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-pi-skills-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspaceDir = path.join(root, 'workspace');
  await mkdir(workspaceDir);
  for (const name of ['lark-shared', 'lark-im', 'lark-event']) {
    const dir = path.join(root, '.pi_agent/skills', name);
    await mkdir(path.join(dir, 'references'), { recursive: true });
    await writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Lark integration\n---\nSee references for details.`);
    await writeFile(path.join(dir, 'references/example.md'), 'reference stays beside its skill');
  }
  const route = await load('../../app/api/studio/workspaces/[workspaceId]/skills/route.ts', {
    'next/server': { NextResponse: { json: Response.json } },
    '@/app/api/_lib/auth': { requireAuth: () => 'u' },
    '@/app/api/_lib/db': { default: { studioWorkspace: { findFirst: async ({ where }) => where.id === 'w' ? {} : null } } },
    '@/lib/coding-agents/sandbox': { resolveStudioWorkspace: async () => workspaceDir },
    '@/lib/coding-agents/workspace-skills': workspaceSkills,
  });
  const params = { params: Promise.resolve({ workspaceId: 'w' }) };
  const listed = await (await route.GET({}, params)).json();
  assert.deepEqual(listed.skills.map(s => s.name).sort(), ['lark-event','lark-im','lark-shared']);
  assert.equal((await settings.readWorkspaceSkills(workspaceDir)).length, 3);
  const toggle = enabled => route.PATCH({ json: async () => ({ skillId: 'config:lark-im', enabled }) }, params);
  assert.equal((await toggle(false)).status, 200);
  assert.equal((await settings.readWorkspaceSkills(workspaceDir)).length, 2);
  assert.equal((await (await route.GET({}, params)).json()).skills.find(s => s.name === 'lark-im').enabled, false);
  assert.equal((await toggle(true)).status, 200);
  assert.equal((await settings.readWorkspaceSkills(workspaceDir)).length, 3);
  assert.equal((await route.DELETE(new Request('http://localhost?skillId=config%3Alark-im'), params)).status, 200);
  assert.equal((await settings.readWorkspaceSkills(workspaceDir)).length, 2);
  await assert.rejects(readFile(path.join(root, '.pi_agent/skills/lark-im/references/example.md')), { code: 'ENOENT' });
  assert.equal((await route.PATCH({ json: async () => ({ skillId: 'config:../escape', enabled: true }) }, params)).status, 400);
  assert.equal((await route.GET({}, { params: Promise.resolve({ workspaceId: 'foreign' }) })).status, 404);
  const installed = await route.POST({ json: async () => ({ action: 'preset', presetId: 'code-reviewer' }) }, params);
  assert.equal(installed.status, 200);
  assert.ok((await readFile(path.join(root, '.pi_agent/skills/code-reviewer/SKILL.md'), 'utf8')).includes('name: code-reviewer'));
  await assert.rejects(readFile(path.join(workspaceDir, '.pi/skills/code-reviewer/SKILL.md')), { code: 'ENOENT' });
});

test('legacy skills migrate as complete directories with their enabled state and stable plain IDs', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-skill-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspaceDir = path.join(root, 'workspace');
  const legacyDir = path.join(workspaceDir, '.pi/skills');
  for (const name of ['enabled', 'disabled']) {
    await mkdir(path.join(legacyDir, name, 'references'), { recursive: true });
    await writeFile(path.join(legacyDir, name, name === 'enabled' ? 'SKILL.md' : 'SKILL.md.disabled'), `skill ${name}`);
    await writeFile(path.join(legacyDir, name, 'references/usage.md'), `reference ${name}`);
  }
  const [first, second] = await Promise.all([
    workspaceSkills.discoverWorkspaceSkills(workspaceDir), workspaceSkills.discoverWorkspaceSkills(workspaceDir),
  ]);
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.equal(first.find(skill => skill.id === 'disabled').enabled, false);
  assert.equal(first.find(skill => skill.id === 'enabled').enabled, true);
  assert.equal(await readFile(path.join(root, '.pi_agent/skills/disabled/references/usage.md'), 'utf8'), 'reference disabled');
  await assert.rejects(readdir(legacyDir), { code: 'ENOENT' });
  assert.equal((await settings.readWorkspaceSkills(workspaceDir)).length, 1);
  const location = await workspaceSkills.resolveWorkspaceSkill(workspaceDir, 'enabled');
  await rm(location.folder, { recursive: true });
  assert.equal((await workspaceSkills.discoverWorkspaceSkills(workspaceDir)).length, 1);
  assert.equal((await settings.readWorkspaceSkills(workspaceDir)).length, 0);
});

test('migration backs up conflicting copies and keeps the canonical version without following escaping symlinks', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-skill-roots-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'studio-skill-outside-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  const workspaceDir = path.join(root, 'workspace');
  await mkdir(path.join(workspaceDir, '.pi/skills/demo'), { recursive: true });
  await mkdir(path.join(root, '.pi_agent/skills/demo'), { recursive: true });
  await writeFile(path.join(workspaceDir, '.pi/skills/demo/SKILL.md.disabled'), 'disabled workspace version');
  await writeFile(path.join(root, '.pi_agent/skills/demo/SKILL.md'), 'active config duplicate');
  await writeFile(path.join(outside, 'SKILL.md'), 'outside skill');
  await symlink(outside, path.join(workspaceDir, '.pi/skills/escape'), 'junction');
  const list = await workspaceSkills.discoverWorkspaceSkills(workspaceDir);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'demo');
  assert.equal(list[0].enabled, true);
  assert.equal(list[0].content, 'active config duplicate');
  const backups = await readdir(path.join(root, '.pi_agent/skill-backups'));
  assert.equal(backups.length, 1);
  assert.equal(await readFile(path.join(root, '.pi_agent/skill-backups', backups[0], 'SKILL.md.disabled'), 'utf8'), 'disabled workspace version');
  await workspaceSkills.discoverWorkspaceSkills(workspaceDir);
  assert.equal((await readdir(path.join(root, '.pi_agent/skill-backups'))).length, 1);
});

test('launcher translates config skill paths for both host and Docker environments', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-skill-launch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let mode = 'host';
  const launcher = await load('./pi-launch.ts', {
    './workspace-skills': workspaceSkills,
    './sandbox': { buildSanitizedEnv: () => ({}) },
    './sandbox/policy': { resolveSandboxMode: () => mode, buildStudioSandboxPolicy: options => ({ ...options, containerName: 'test' }) },
    './sandbox/docker-args': { buildDockerRunArgs: (policy, args) => args },
    './sandbox/docker-driver': { getDockerAvailability: async () => ({ available: true }), ensureStudioAgentImage: async () => {}, writeSandboxEnvFile: async () => {} },
    '../core/model-client': { DEFAULT_MODEL: 'default', DEFAULT_BASE_URL: 'https://default' },
  });
  const options = {
    userId: 'u', sessionId: 'w', workspaceDir: path.join(root, 'workspace'), customApiKey: 'key',
    agentArgs: ['--no-skills', '--skill', `${workspaceSkills.PI_CONFIG_SKILL_PREFIX}lark-im/SKILL.md`],
  };
  const host = await launcher.buildPiLaunchSpec(options);
  assert.ok(host.args.includes(path.join(root, '.pi_agent/skills/lark-im/SKILL.md').replace(/\\/g, '/')));
  mode = 'docker';
  const docker = await launcher.buildPiLaunchSpec(options);
  assert.ok(docker.args.includes('/pi-config/skills/lark-im/SKILL.md'));
  assert.ok(!docker.args.some(arg => arg.includes('__PI_CONFIG_DIR__')));
});

test('user-level legacy skills move only to the explicitly selected owned workspace without overwriting conflicts', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-user-skills-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const userDir = path.join(root, 'u');
  const workspaceDir = path.join(userDir, 'selected/workspace');
  const otherDir = path.join(userDir, 'other/workspace');
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(otherDir, { recursive: true });
  for (const name of ['lark-im', 'conflict']) {
    const folder = path.join(userDir, '.pi_agent/skills', name);
    await mkdir(path.join(folder, 'references'), { recursive: true });
    await writeFile(path.join(folder, 'SKILL.md.disabled'), `legacy ${name}`);
    await writeFile(path.join(folder, 'references/usage.md'), 'complete supporting files');
  }
  const current = await workspaceSkills.resolveWorkspaceSkill(workspaceDir, 'conflict');
  await mkdir(current.folder, { recursive: true });
  await writeFile(path.join(current.folder, 'SKILL.md'), 'keep current version');
  const route = await load('../../app/api/studio/workspaces/[workspaceId]/skills/route.ts', {
    'next/server': { NextResponse: { json: Response.json } },
    '@/app/api/_lib/auth': { requireAuth: () => 'u' },
    '@/app/api/_lib/db': { default: { studioWorkspace: { findFirst: async ({ where }) => where.id === 'selected' ? {} : null } } },
    '@/lib/coding-agents/sandbox': { resolveStudioWorkspace: async () => workspaceDir },
    '@/lib/coding-agents/workspace-skills': workspaceSkills,
  });
  const params = { params: Promise.resolve({ workspaceId: 'selected' }) };
  const listed = await (await route.GET({}, params)).json();
  assert.equal(listed.legacySkillCount, 2);
  assert.equal(listed.skills.length, 1);
  assert.equal((await workspaceSkills.discoverWorkspaceSkills(otherDir)).length, 0);
  const request = { json: async () => ({ action: 'import-legacy' }) };
  assert.equal((await route.POST(request, { params: Promise.resolve({ workspaceId: 'foreign' }) })).status, 404);
  const result = await (await route.POST(request, params)).json();
  assert.deepEqual(result.imported, ['lark-im']);
  assert.deepEqual(result.skipped, ['conflict']);
  assert.equal(await readFile(path.join(userDir, 'selected/.pi_agent/skills/lark-im/references/usage.md'), 'utf8'), 'complete supporting files');
  assert.equal((await workspaceSkills.discoverWorkspaceSkills(workspaceDir)).find(s => s.id === 'lark-im').enabled, false);
  assert.equal(await readFile(path.join(current.folder, 'SKILL.md'), 'utf8'), 'keep current version');
  assert.equal((await workspaceSkills.discoverLegacyUserSkills(workspaceDir)).length, 1);
  assert.equal((await workspaceSkills.discoverWorkspaceSkills(otherDir)).length, 0);
  assert.equal((await (await route.POST(request, params)).json()).imported.length, 0);
});
