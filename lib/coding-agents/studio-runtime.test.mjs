import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, mkdir, writeFile, rename, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn as spawnNative } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
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
    exports, process, Buffer, console, Error, Response, TextEncoder, ReadableStream, URL, AbortController,
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

test('sandbox image version follows the pinned Pi dependency and stale custom tags require rebuilding', async (t) => {
  const packageInfo = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const policy = await load('./sandbox/policy.ts', { '../../../package.json': { default: packageInfo } });
  const version = packageInfo.dependencies['@earendil-works/pi-coding-agent'];
  const previousImage = process.env.STUDIO_AGENT_IMAGE;
  const previousAutoBuild = process.env.STUDIO_AGENT_AUTO_BUILD;
  t.after(() => {
    if (previousImage === undefined) delete process.env.STUDIO_AGENT_IMAGE; else process.env.STUDIO_AGENT_IMAGE = previousImage;
    if (previousAutoBuild === undefined) delete process.env.STUDIO_AGENT_AUTO_BUILD; else process.env.STUDIO_AGENT_AUTO_BUILD = previousAutoBuild;
  });
  delete process.env.STUDIO_AGENT_IMAGE;
  assert.equal(policy.resolveStudioAgentImage(), `almaren/studio-agent:pi-${version}`);
  let imageVersion = '0.85.1';
  const calls = [];
  const execFile = () => {};
  execFile[promisify.custom] = async (command, args) => {
    calls.push(args);
    return { stdout: args[0] === 'image' ? imageVersion : '' };
  };
  const driver = await load('./sandbox/docker-driver.ts', {
    './policy': policy, 'node:child_process': { execFile },
  });
  process.env.STUDIO_AGENT_AUTO_BUILD = '0';
  await assert.rejects(driver.ensureStudioAgentImage({ image: 'custom-tag' }), /版本不匹配/);
  assert.equal(calls.length, 1);
  process.env.STUDIO_AGENT_AUTO_BUILD = '1';
  await driver.ensureStudioAgentImage({ image: 'custom-tag' });
  assert.deepEqual(Array.from(calls.at(-1)), ['build', '--build-arg', `PI_VERSION=${version}`, '-t', 'custom-tag', policy.STUDIO_AGENT_IMAGE_CONTEXT]);
  imageVersion = version;
  const before = calls.length;
  await driver.ensureStudioAgentImage({ image: 'custom-tag' });
  assert.equal(calls.length, before + 1);
});

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

async function runtimeFixture(t, { launch, real = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-runtime-'));
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  const children = [], launches = [];
  const approvals = [];
  const module = await load('./pi-runtime.ts', {
    './sandbox': { resolveStudioWorkspace: async () => workspace },
    './runtime-settings': settings,
    '../core/model-client': { DEFAULT_MODEL: 'default', DEFAULT_BASE_URL: 'https://default' },
    './pi-launch': { PI_SESSION_PLACEHOLDER: '__SESSION__', buildPiLaunchSpec: async (options) => {
      launches.push(options);
      if (launch) return launch({ ...options, root });
      return { kind: 'host', command: 'mock', args: [], cwd: workspace, env: {} };
    } },
    './sandbox/docker-driver': { removeSandboxEnvFile: async () => {} },
    './approval-store': { approvalStore: { createApproval() {
      let decide;
      const promise = new Promise(resolve => { decide = resolve; });
      approvals.push(decide);
      return { approvalId: `approval-${approvals.length}`, promise };
    } } },
    './secret-redaction': { redactSecrets: (text) => text },
    'node:child_process': { spawn: (command, args, options) => {
      const child = real ? spawnNative(command, args, { ...options, windowsHide: true }) : new EventEmitter();
      child.commands = [];
      if (real) {
        const write = child.stdin.write.bind(child.stdin);
        child.stdin.write = (line) => { child.commands.push(JSON.parse(line)); return write(line); };
        children.push(child);
        return child;
      }
      child.exitCode = null;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
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
      extra.onEvent?.(event);
      if (event.type === 'run.started') started();
    } });
    await Promise.race([ready, turn.then(() => { throw Error('No run.started'); })]);
    return { turn, child: children.at(-1) };
  }
  function end(child) { child.stdout.emit('data', Buffer.from('{"type":"agent_settled"}\n')); }
  return { root, workspace, runtime, base, launches, children, events, approvals, start, end };
}

test('real Pi and the Studio runtime cancel one duplicate while retaining the other inputs and their IDs', { timeout: 30000 }, async (t) => {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    const tool = requests.length === 1;
    const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: 'write-call', type: 'function',
      function: { name: 'write', arguments: JSON.stringify({ path: 'result.txt', content: 'ok' }) } }] }
      : { role: 'assistant', content: 'finished' };
    const packet = (delta, finish_reason = null) => ({ id: 'local', object: 'chat.completion.chunk', created: 1,
      model: 'test', choices: [{ index: 0, delta, finish_reason }] });
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify(packet(delta))}\n\n`);
    response.end(`data: ${JSON.stringify(packet({}, tool ? 'tool_calls' : 'stop'))}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const f = await runtimeFixture(t, { real: true, launch: async ({ root, workspaceDir }) => {
    const config = path.join(root, 'config');
    await mkdir(config, { recursive: true });
    await writeFile(path.join(config, 'models.json'), JSON.stringify({ providers: { custom: {
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'local-key',
      models: [{ id: 'test', name: 'test', reasoning: false, input: ['text'], contextWindow: 8192, maxTokens: 1024 }],
    } } }));
    await writeFile(path.join(config, 'settings.json'), JSON.stringify({ cacheWarming: 'off', retry: { enabled: false } }));
    return { kind: 'host', command: process.execPath, cwd: workspaceDir,
      args: [path.resolve('node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'), '--mode', 'rpc', '--provider', 'custom',
        '--model', 'test', '--session', path.join(root, 'session.jsonl'), '--no-skills', '--no-prompt-templates', '--no-context-files',
        '--no-extensions', '--extension', path.resolve('docker/studio-agent/extensions/approval.ts')],
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: tmpdir(), HOME: root,
        PI_CODING_AGENT_DIR: config, PI_OFFLINE: '1', STUDIO_APPROVAL_MODE: 'always' } };
  } });
  let approved;
  const approvalReady = new Promise(resolve => { approved = resolve; });
  const { turn } = await f.start({ modelName: 'test', approvalMode: 'always', message: 'write result.txt',
    onEvent(event) { if (event.type === 'tool.approval_requested') approved(); } });
  await Promise.race([approvalReady, turn.then(() => { throw Error('Pi ended before approval'); })]);
  const submit = (message, mode = 'followUp') => f.runtime.submitUserMessage({ userId: 'u', workspaceId: 'w', mode, message });
  await submit('same-input');
  await submit('same-input');
  await submit('last-input');
  await submit('steering-input', 'steer');
  const before = f.events.filter(event => event.type === 'queue.updated').at(-1).data.items;
  const target = before[1];
  assert.equal(await f.runtime.cancelQueuedMessage({ userId: 'u', workspaceId: 'w', runId: 'r', itemId: target.id }), true);
  const after = f.events.filter(event => event.type === 'queue.updated').at(-1).data.items;
  const retained = [before[3], before[0], before[2]];
  assert.deepEqual(Array.from(after, item => item.id), retained.map(item => item.id));
  f.approvals[0]({ action: 'approve' });
  await turn;
  const delivered = f.events.filter(event => event.type === 'user.message_injected');
  assert.deepEqual(delivered.map(event => event.data.queueItemId), retained.map(item => item.id));
  assert.deepEqual(delivered.map(event => event.data.message), ['steering-input', 'same-input', 'last-input']);
  const session = await readFile(path.join(f.root, 'session.jsonl'), 'utf8');
  const users = session.trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.type === 'message' && entry.message.role === 'user');
  assert.deepEqual(users.map(entry => entry.message.content[0].text), ['write result.txt', 'steering-input', 'same-input', 'last-input']);
  assert.equal(await readFile(path.join(f.workspace, 'result.txt'), 'utf8'), 'ok');
  assert.ok(requests.length >= 3);
});

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
      runStudioPiTurn: (options) => {
        runs.push(options);
        return f.runtime.runTurn({ ...options, onEvent(event) { f.events.push(event); options.onEvent(event); } });
      },
      resetStudioPiSession: (userId, workspaceId) => f.runtime.resetSession(`${userId}:${workspaceId}`, { userId, workspaceId }),
      injectStudioUserMessage: (params) => f.runtime.submitUserMessage(params),
      clearStudioMessageQueue: (params) => f.runtime.clearQueue(params),
      cancelStudioQueuedMessage: (params) => f.runtime.cancelQueuedMessage(params),
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

async function enqueueFixture(f, message, mode = 'followUp', expanded = message) {
  const child = f.children[0];
  const start = child.commands.length;
  const result = f.inject.POST({ json: async () => ({ workspaceId: 'w', message, mode }) });
  const type = mode === 'steer' ? 'steer' : 'follow_up';
  await until(() => child.commands.slice(start).some(command => command.type === type));
  const command = child.commands.at(-1);
  const previous = f.events.filter(event => event.type === 'queue.updated').at(-1)?.data || { steering: [], followUp: [] };
  const key = mode === 'steer' ? 'steering' : 'followUp';
  f.emit({ type: 'queue_update', steering: [...previous.steering], followUp: [...previous.followUp], [key]: [...previous[key], expanded] });
  f.emit({ type: 'response', command: type, id: command.id, success: true, data: { disposition: 'queued' } });
  assert.equal((await result).status, 200);
  return f.events.filter(event => event.type === 'queue.updated').at(-1).data.items.at(-1);
}

async function replayFixture(f, commandStart, texts) {
  const queue = { steering: [], followUp: [] };
  for (let i = 0; i < texts.length; i++) {
    await until(() => f.children[0].commands.slice(commandStart).filter(command => command.type === 'prompt').length > i);
    const command = f.children[0].commands.slice(commandStart).filter(command => command.type === 'prompt')[i];
    assert.equal(command.message, texts[i]);
    queue[command.streamingBehavior === 'steer' ? 'steering' : 'followUp'].push(texts[i]);
    f.emit({ type: 'queue_update', steering: [...queue.steering], followUp: [...queue.followUp] });
    f.emit({ type: 'response', command: 'prompt', id: command.id, success: true, data: { disposition: 'queued' } });
  }
}

test('single cancellation preserves duplicate IDs, mode, order and persisted messages', async (t) => {
  const f = await conversationFixture(t);
  const response = await f.post();
  await until(() => f.children.length === 1);
  const first = await enqueueFixture(f, 'same');
  const target = await enqueueFixture(f, 'same');
  const last = await enqueueFixture(f, '/skill:demo help', 'steer', 'expanded skill prompt');
  assert.notEqual(first.id, target.id);
  const commandStart = f.children[0].commands.length;
  const cancelling = f.inject.DELETE({ json: async () => ({ workspaceId: 'w', runId: f.runs[0].runId, itemId: target.id }) });
  await until(() => f.children[0].commands.slice(commandStart).some(command => command.type === 'clear_queue'));
  const command = f.children[0].commands.at(-1);
  const snapshotsBefore = f.events.filter(event => event.type === 'queue.updated').length;
  f.emit({ type: 'queue_update', steering: [], followUp: [] });
  assert.equal(f.events.filter(event => event.type === 'queue.updated').length, snapshotsBefore, 'No transient empty snapshot during replay');
  f.emit({ type: 'response', command: 'clear_queue', id: command.id, success: true,
    data: { steering: ['expanded skill prompt'], followUp: ['same', 'same'] } });
  await replayFixture(f, commandStart, ['expanded skill prompt', 'same']);
  assert.equal((await cancelling).status, 200);
  const items = f.events.filter(event => event.type === 'queue.updated').at(-1).data.items;
  assert.deepEqual(Array.from(items, item => item.id), [last.id, first.id]);
  assert.deepEqual(Array.from(items, item => item.message), ['/skill:demo help', 'same']);
  f.emit({ type: 'queue_update', steering: [], followUp: ['same'] });
  f.emit({ type: 'message_start', message: { role: 'user', content: 'expanded skill prompt' } });
  f.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'skill answer' } });
  f.emit({ type: 'queue_update', steering: [], followUp: [] });
  f.emit({ type: 'message_start', message: { role: 'user', content: 'same' } });
  f.end(f.children[0]); await response.text();
  assert.deepEqual(f.events.filter(event => event.type === 'user.message_injected').map(event => event.data.queueItemId), [last.id, first.id]);
  assert.deepEqual(f.rows.filter(row => row.role === 'user').map(row => row.content), ['new question', '/skill:demo help', 'same']);
});

test('a cancellation race restores all remaining input and reports that the requested message already started', async (t) => {
  const f = await conversationFixture(t);
  const response = await f.post();
  await until(() => f.children.length === 1);
  const target = await enqueueFixture(f, 'same');
  const retained = await enqueueFixture(f, 'same');
  const start = f.children[0].commands.length;
  const cancelling = f.inject.DELETE({ json: async () => ({ workspaceId: 'w', runId: f.runs[0].runId, itemId: target.id }) });
  await until(() => f.children[0].commands.length > start);
  const command = f.children[0].commands.at(-1);
  f.emit({ type: 'queue_update', steering: [], followUp: ['same'] });
  f.emit({ type: 'message_start', message: { role: 'user', content: 'same' } });
  f.emit({ type: 'queue_update', steering: [], followUp: [] });
  f.emit({ type: 'response', command: 'clear_queue', id: command.id, success: true, data: { steering: [], followUp: ['same'] } });
  await replayFixture(f, start, ['same']);
  assert.equal((await cancelling).status, 409);
  const snapshot = f.events.filter(event => event.type === 'queue.updated').at(-1).data;
  assert.equal(snapshot.items[0].id, retained.id);
  const count = f.children[0].commands.length;
  assert.equal((await f.inject.DELETE({ json: async () => ({ workspaceId: 'w', runId: f.runs[0].runId, itemId: target.id }) })).status, 409);
  assert.equal(f.children[0].commands.length, count, 'A stale item ID cannot clear other messages');
  f.emit({ type: 'queue_update', steering: [], followUp: [] });
  f.emit({ type: 'message_start', message: { role: 'user', content: 'same' } });
  f.end(f.children[0]); await response.text();
  assert.deepEqual(f.events.filter(event => event.type === 'user.message_injected').map(event => event.data.queueItemId), [target.id, retained.id]);
});

test('Pi settling during cancellation cannot close the stream before retained messages are restarted', async (t) => {
  const f = await conversationFixture(t);
  const response = await f.post();
  await until(() => f.children.length === 1);
  const target = await enqueueFixture(f, 'cancel');
  const retained = await enqueueFixture(f, 'retain');
  const start = f.children[0].commands.length;
  const cancelling = f.inject.DELETE({ json: async () => ({ workspaceId: 'w', runId: f.runs[0].runId, itemId: target.id }) });
  await until(() => f.children[0].commands.length > start);
  const command = f.children[0].commands.at(-1);
  f.emit({ type: 'queue_update', steering: [], followUp: [] });
  f.end(f.children[0]);
  assert.ok(!f.events.some(event => event.type === 'run.completed'));
  f.emit({ type: 'response', command: 'clear_queue', id: command.id, success: true, data: { steering: [], followUp: ['cancel', 'retain'] } });
  await until(() => f.children[0].commands.slice(start).some(command => command.type === 'prompt'));
  const replay = f.children[0].commands.at(-1);
  f.emit({ type: 'agent_start' });
  f.emit({ type: 'message_start', message: { role: 'user', content: 'retain' } });
  f.emit({ type: 'response', command: 'prompt', id: replay.id, success: true, data: { disposition: 'started' } });
  assert.equal((await cancelling).status, 200);
  assert.ok(!f.events.some(event => event.type === 'run.completed'));
  f.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'continued' } });
  f.end(f.children[0]); await response.text();
  assert.equal(f.events.filter(event => event.type === 'user.message_injected')[0].data.queueItemId, retained.id);
  assert.deepEqual(f.rows.filter(row => row.role === 'user').map(row => row.content), ['new question', 'retain']);
});

test('a replay rejection exposes recoverable messages and does not leave an already idle turn running', async (t) => {
  const f = await conversationFixture(t);
  const response = await f.post();
  await until(() => f.children.length === 1);
  const target = await enqueueFixture(f, 'cancel');
  await enqueueFixture(f, 'recover this');
  const start = f.children[0].commands.length;
  const cancelling = f.inject.DELETE({ json: async () => ({ workspaceId: 'w', runId: f.runs[0].runId, itemId: target.id }) });
  await until(() => f.children[0].commands.length > start);
  const command = f.children[0].commands.at(-1);
  f.emit({ type: 'queue_update', steering: [], followUp: [] });
  f.end(f.children[0]);
  f.emit({ type: 'response', command: 'clear_queue', id: command.id, success: true, data: { steering: [], followUp: ['cancel', 'recover this'] } });
  await until(() => f.children[0].commands.slice(start).some(command => command.type === 'prompt'));
  const replay = f.children[0].commands.at(-1);
  f.emit({ type: 'response', command: 'prompt', id: replay.id, success: false, error: 'replay rejected' });
  assert.equal((await cancelling).status, 500);
  await response.text();
  assert.ok(f.events.some(event => event.type === 'run.notice' && event.data.message.includes('recover this')));
  assert.ok(f.events.some(event => event.type === 'run.completed'));
  assert.equal(f.events.filter(event => event.type === 'user.message_injected').length, 0);
});

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
  const injecting = f.inject.POST({ json: async () => ({ workspaceId: 'w', message: 'injected question' }) });
  await until(() => f.children[0].commands.some(command => command.type === 'steer'));
  const command = f.children[0].commands.find(command => command.type === 'steer');
  f.emit({ type: 'queue_update', steering: ['injected question'], followUp: [] });
  f.emit({ type: 'response', id: command.id, command: 'steer', success: true, data: { disposition: 'queued' } });
  const injected = await injecting;
  assert.equal(injected.status, 200);
  assert.deepEqual(f.rows.map(row => row.content), ['new question']);
  f.emit({ type: 'queue_update', steering: [], followUp: [] });
  f.emit({ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: 'injected question' }] } });
  f.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'second segment' } });
  f.end(f.children[0]);
  const output = await response.text();
  const event = JSON.parse(output.split('\n').find(line => line.includes('user.message_injected')).slice(6));
  assert.deepEqual(f.rows.map(row => row.content), ['new question','first segment','injected question','second segment']);
  assert.equal(f.rows[2].id, event.data.userMessageId);
  assert.equal(f.rows[3].id, event.data.assistantMessageId);
  assert.ok(f.rows.every((row, i) => i === 0 || row.createdAt > f.rows[i-1].createdAt));
});

test('clearing the queue cancels only pending input, even when identical input starts during the clear', async (t) => {
  const f = await conversationFixture(t);
  const response = await f.post();
  await until(() => f.children.length === 1);
  const child = f.children[0];
  for (let i = 0; i < 2; i++) {
    const injecting = f.inject.POST({ json: async () => ({ workspaceId: 'w', message: 'same message', mode: 'followUp' }) });
    await until(() => child.commands.filter(command => command.type === 'follow_up').length === i + 1);
    const command = child.commands.at(-1);
    f.emit({ type: 'queue_update', steering: [], followUp: Array(i + 1).fill('same message') });
    f.emit({ type: 'response', id: command.id, command: 'follow_up', success: true, data: { disposition: 'queued' } });
    assert.equal((await injecting).status, 200);
  }
  f.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'original answer' } });
  const clearing = f.inject.DELETE({ json: async () => ({ workspaceId: 'w', runId: f.runs[0].runId }) });
  await until(() => child.commands.some(command => command.type === 'clear_queue'));
  const command = child.commands.at(-1);
  // Pi removes the first item from the queue before forwarding message_start.
  f.emit({ type: 'queue_update', steering: [], followUp: ['same message'] });
  f.emit({ type: 'queue_update', steering: [], followUp: [] });
  f.emit({ type: 'response', id: command.id, command: 'clear_queue', success: true, data: { steering: [], followUp: ['same message'] } });
  assert.equal((await clearing).status, 200);
  f.emit({ type: 'message_start', message: { role: 'user', content: 'same message' } });
  f.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'delivered answer' } });
  f.end(child);
  const output = await response.text();
  assert.equal(output.split('user.message_injected').length - 1, 1);
  assert.deepEqual(f.rows.map(row => row.content), ['new question', 'original answer', 'same message', 'delivered answer']);
});

test('cleared messages never enter persisted history; queue operations reject foreign workspaces and stale runs', async (t) => {
  const f = await conversationFixture(t);
  const response = await f.post();
  await until(() => f.children.length === 1);
  const child = f.children[0];
  const foreign = await f.inject.DELETE({ json: async () => ({ workspaceId: 'foreign', runId: 'r' }) });
  assert.equal(foreign.status, 404);
  const stale = await f.inject.DELETE({ json: async () => ({ workspaceId: 'w', runId: 'old-run' }) });
  assert.equal(stale.status, 409);
  assert.ok(!child.commands.some(command => command.type === 'clear_queue'));
  const injecting = f.inject.POST({ json: async () => ({ workspaceId: 'w', message: 'cancel this' }) });
  await until(() => child.commands.some(command => command.type === 'steer'));
  let command = child.commands.at(-1);
  f.emit({ type: 'queue_update', steering: ['cancel this'], followUp: [] });
  f.emit({ type: 'response', id: command.id, command: 'steer', success: true, data: { disposition: 'queued' } });
  assert.equal((await injecting).status, 200);
  const clearing = f.inject.DELETE({ json: async () => ({ workspaceId: 'w', runId: f.runs[0].runId }) });
  await until(() => child.commands.some(command => command.type === 'clear_queue'));
  command = child.commands.at(-1);
  f.emit({ type: 'queue_update', steering: [], followUp: [] });
  f.emit({ type: 'response', id: command.id, command: 'clear_queue', success: true, data: { steering: ['cancel this'], followUp: [] } });
  assert.equal((await clearing).status, 200);
  f.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'only original answer' } });
  f.end(child);
  const output = await response.text();
  assert.ok(!output.includes('user.message_injected'));
  assert.deepEqual(f.rows.map(row => row.content), ['new question', 'only original answer']);
});

test('runtime waits for Pi acknowledgement, distinguishes handled input, and cleans up RPC failures', async (t) => {
  const f = await runtimeFixture(t);
  const { child, turn } = await f.start();
  const emit = event => child.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
  const submit = message => f.runtime.submitUserMessage({ userId: 'u', workspaceId: 'w', message, mode: 'steer' });
  const handled = submit('/extension-command');
  await until(() => child.commands.some(command => command.type === 'steer'));
  let command = child.commands.at(-1);
  emit({ type: 'response', id: command.id, command: 'steer', success: true, data: { disposition: 'handled' } });
  assert.equal((await handled).disposition, 'handled');
  const rejected = submit('reject this');
  const rejects = assert.rejects(rejected, /rejected by Pi/);
  await until(() => child.commands.filter(command => command.type === 'steer').length === 2);
  command = child.commands.at(-1);
  emit({ type: 'response', id: command.id, command: 'steer', success: false, error: 'rejected by Pi' });
  await rejects;
  const interrupted = submit('connection lost');
  const interruptedCheck = assert.rejects(interrupted, /任务已结束|断开/);
  const turnCheck = assert.rejects(turn, /进程已退出/);
  await until(() => child.commands.filter(command => command.type === 'steer').length === 3);
  child.kill();
  await Promise.all([interruptedCheck, turnCheck]);
  assert.ok(!f.events.some(event => event.type === 'user.message_injected'));
});

test('approval waiting overrides execution and compaction; decisions and abort restore the correct lifecycle', async (t) => {
  const f = await runtimeFixture(t);
  const controller = new AbortController();
  const { child, turn } = await f.start({ approvalMode: 'always', signal: controller.signal });
  const emit = event => child.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
  const status = () => f.events.filter(event => event.type === 'run.status').at(-1).data.status;
  assert.equal(status(), 'running');
  emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'think' } });
  assert.equal(status(), 'thinking');
  for (const id of ['first', 'second']) {
    emit({ type: 'tool_execution_start', toolCallId: id, toolName: 'write', args: { path: `${id}.md` } });
    emit({ type: 'extension_ui_request', id, method: 'confirm' });
  }
  assert.equal(status(), 'waiting_confirmation');
  emit({ type: 'compaction_start' });
  assert.equal(status(), 'waiting_confirmation');
  f.approvals[0]({ action: 'approve' });
  await until(() => child.commands.some(command => command.id === 'first'));
  assert.equal(status(), 'waiting_confirmation');
  f.approvals[1]({ action: 'deny' });
  await until(() => child.commands.some(command => command.id === 'second'));
  assert.equal(status(), 'compacting');
  emit({ type: 'compaction_start' });
  assert.equal(status(), 'compacting');
  emit({ type: 'compaction_end', errorMessage: 'summary failed' });
  assert.equal(status(), 'running');
  assert.ok(f.events.some(event => event.type === 'run.notice' && event.data.message.includes('summary failed')));
  controller.abort();
  assert.deepEqual(child.commands.slice(-2).map(command => command.type), ['clear_queue', 'abort']);
  f.end(child); await turn;
});

test('queue mutations are ordered and expanded skill input persists the original user command only on delivery', async (t) => {
  const f = await runtimeFixture(t);
  const { child, turn } = await f.start();
  const emit = event => child.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
  const injecting = f.runtime.submitUserMessage({ userId: 'u', workspaceId: 'w', message: '/skill:demo help', mode: 'steer' });
  const clearing = f.runtime.clearQueue({ userId: 'u', workspaceId: 'w', runId: 'r' });
  await until(() => child.commands.some(command => command.type === 'steer'));
  assert.ok(!child.commands.some(command => command.type === 'clear_queue'));
  const command = child.commands.at(-1);
  emit({ type: 'queue_update', steering: ['expanded skill prompt'], followUp: [] });
  emit({ type: 'response', command: 'steer', id: command.id, success: true, data: { disposition: 'queued' } });
  await injecting;
  await until(() => child.commands.some(command => command.type === 'clear_queue'));
  const clearCommand = child.commands.at(-1);
  // The input starts before the queued clear gets to Pi; it must remain in chat.
  emit({ type: 'queue_update', steering: [], followUp: [] });
  emit({ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: 'expanded skill prompt' }] } });
  emit({ type: 'response', command: 'clear_queue', id: clearCommand.id, success: true, data: { steering: [], followUp: [] } });
  await clearing;
  assert.equal(f.events.find(event => event.type === 'user.message_injected').data.message, '/skill:demo help');
  f.end(child); await turn;
});

test('interrupted approval is closed in both SSE and persisted tool state', async (t) => {
  const f = await conversationFixture(t);
  const response = await f.post({ approvalMode: 'always' });
  await until(() => f.children.length === 1);
  f.emit({ type: 'tool_execution_start', toolCallId: 'write', toolName: 'write', args: { path: 'file.md' } });
  f.emit({ type: 'extension_ui_request', id: 'confirm-write', method: 'confirm' });
  f.children[0].kill();
  const output = await response.text();
  const events = output.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  assert.ok(events.some(event => event.type === 'run.failed'));
  assert.ok(events.some(event => event.type === 'tool.failed' && event.data.toolCallId === 'write' && event.data.isDenied));
  assert.equal(f.rows.at(-1).tools[0].status, 'denied');
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
