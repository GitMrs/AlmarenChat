import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const compile = async file => ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const proxySource = await compile('../web/proxy.ts');
const clientSource = await compile('./model-client.ts');
const fetchSource = await compile('./model-fetch.mjs');
const connectionError = () => new TypeError('fetch failed', { cause: Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }) });

function fixture(fetch, { hasProxy = true } = {}) {
  const attempts = [];
  const timers = [];
  const dependencies = {
    'node:net': { Socket: class extends (require('node:events').EventEmitter) {
      setTimeout() {}
      destroy() {}
      connect() { queueMicrotask(() => this.emit('error', new Error('fixture port closed'))); }
    } },
    undici: {
      Agent: class { kind = 'direct'; constructor(options) { this.options = options; } },
      ProxyAgent: class { kind = 'proxy'; constructor(options) { this.options = options; } },
      EnvHttpProxyAgent: class {}, setGlobalDispatcher() {},
      fetch: async (url, init) => { attempts.push({ url, ...init }); return fetch(url, init); },
    },
  };
  const exports = {};
  vm.runInNewContext(proxySource, {
    exports, require: name => dependencies[name], URL, AbortController, AbortSignal,
    // Proxy detection stays deterministic regardless of the developer's real proxy.
    process: { env: hasProxy ? { HTTPS_PROXY: 'http://127.0.0.1:7897' } : {} },
    Date,
    console: { warn() {} },
    setTimeout: (_callback, ms) => { timers.push(ms); return timers.length; }, clearTimeout() {},
  });
  const client = {};
  const transport = {};
  const logs = [];
  vm.runInNewContext(fetchSource, { exports: transport, Request, Headers, Response, ReadableStream,
    AbortController, AbortSignal, setTimeout, clearTimeout, process: { env: {} },
    console: { warn: (...args) => logs.push(args) },
    require: name => name === 'node:crypto' ? require(name) : exports });
  vm.runInNewContext(clientSource, {
    exports: client, process: { env: {} },
    require: name => name === 'openai' ? require('openai') : transport,
  });
  return { ...exports, ...client, ...transport, attempts, timers, logs };
}

for (const operation of ['models', 'chat']) {
  test(`${operation} uses the proxy after a direct transport failure and preserves its request`, async () => {
    const current = fixture((_url, init) => {
      if (init.dispatcher.kind === 'direct') throw connectionError();
      return Response.json(operation === 'models'
        ? { data: [{ id: 'fixture-model' }], object: 'list' }
        : { id: 'reply', choices: [{ message: { role: 'assistant', content: '你好' }, finish_reason: 'stop' }] });
    });
    const client = current.createModelClient('https://upstream.test/v1', 'fixture-key', { maxRetries: 0 });
    if (operation === 'models') assert.equal((await client.models.list()).data[0].id, 'fixture-model');
    else assert.equal((await client.chat.completions.create({ model: 'fixture-model', messages: [{ role: 'user', content: 'hello' }] })).choices[0].message.content, '你好');
    assert.deepEqual(current.attempts.map(x => x.dispatcher.kind), ['direct', 'proxy']);
    assert.equal(current.attempts[0].body, current.attempts[1].body);
    assert.equal(current.attempts[0].method, operation === 'models' ? 'GET' : 'POST');
    assert.equal(current.attempts[0].url, current.attempts[1].url);
    assert.equal(current.attempts[0].headers.get('authorization'), current.attempts[1].headers.get('authorization'));
    assert.deepEqual(current.timers, [600_000, 600_000]);
  });
}

for (const status of [401, 403, 429, 500]) {
  test(`model HTTP ${status} is returned without switching proxy`, async () => {
    const current = fixture(() => Response.json({ error: { message: 'upstream error' } }, { status }));
    const client = current.createModelClient('https://upstream.test/v1', 'fixture-key', { maxRetries: 0 });
    await assert.rejects(client.models.list(), error => error.status === status);
    assert.equal(current.attempts.length, 1);
  });
}

test('a failed proxy attempt is not sent to the proxy again by smartFetch', async () => {
  const current = fixture(() => { throw connectionError(); });
  await assert.rejects(current.smartFetch('https://upstream.test', { fallbackOnHttpError: false }), /fetch failed/);
  assert.deepEqual(current.attempts.map(x => x.dispatcher.kind), ['direct', 'proxy']);
});

test('cancellation during connection does not trigger proxy fallback', async () => {
  const controller = new AbortController();
  const current = fixture((_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    controller.abort();
  }));
  await assert.rejects(current.smartFetch('https://upstream.test', { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(current.attempts.map(x => x.dispatcher.kind), ['direct']);
});

test('a stream failing after its first chunk is never replayed on the proxy', async () => {
  const current = fixture(() => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('first chunk')); },
    pull(controller) { controller.error(connectionError()); },
  })));
  const response = await current.smartFetch('https://upstream.test', { fallbackOnHttpError: false });
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'first chunk');
  await assert.rejects(reader.read(), /fetch failed/);
  assert.equal(current.attempts.length, 1);
});

test('without a proxy, the original direct error is preserved', async () => {
  const error = connectionError();
  const current = fixture(() => { throw error; }, { hasProxy: false });
  await assert.rejects(current.smartFetch('https://upstream.test'), e => e === error);
  assert.equal(current.attempts.length, 1);
});

test('explicit direct-only stays direct and uses the supplied timeout', async () => {
  const current = fixture(() => { throw connectionError(); });
  const client = current.createModelClient('https://upstream.test/v1', 'fixture-key', {
    prefer: 'direct-only', timeoutMs: 25_000, maxRetries: 0,
  });
  assert.equal(client.timeout, 25_000);
  await assert.rejects(client.models.list(), /Connection error/);
  assert.deepEqual(current.attempts.map(x => x.dispatcher.kind), ['direct']);
  assert.deepEqual(current.timers, [25_000]);
});

test('model connections get their own short connection limit, not a short first-token timeout', async () => {
  const current = fixture((_url, init) => {
    assert.ok(init.dispatcher);
    assert.equal(init.dispatcher.options.connectTimeout, 5000);
    assert.equal(init.dispatcher.options.headersTimeout, 0);
    return new Response('ok');
  });
  await (await current.createModelFetch()('https://fixture.test')).text();
  const calls = [];
  await (await current.createModelFetch({ timeoutMs: 30_000, fetchImpl: async (_url, init) => {
    calls.push(init);
    return new Response('ok');
  } })('https://fixture.test')).text();
  assert.equal(calls[0].modelTransport, true);
  assert.equal(calls[0].directTimeoutMs, 30_000);
});

test('the total deadline includes a stalled response body and never replays it', async () => {
  const current = fixture(() => {});
  let calls = 0;
  const events = [];
  const fetch = current.createModelFetch({ timeoutMs: 30, log: event => events.push(event), fetchImpl: async () => {
    calls++;
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('first')); } }));
  } });
  const reader = (await fetch('https://secret-user:secret-pass@fixture.test/?token=secret-query', {
    headers: { Authorization: 'Bearer secret-key' }, body: 'private prompt', method: 'POST',
  })).body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'first');
  const keepAlive = setTimeout(() => {}, 100);
  try { await assert.rejects(reader.read(), e => e.code === 'MODEL_REQUEST_TIMEOUT'); }
  finally { clearTimeout(keepAlive); }
  assert.equal(calls, 1);
  assert.equal(events.at(-1).stage, 'request-timeout');
  assert.equal(typeof events[0].requestId, 'string');
  assert.doesNotMatch(JSON.stringify(events), /secret|private prompt/);
});

test('per-call SDK timeout headers cap both routing attempts inside the client budget', async () => {
  const current = fixture(() => {});
  let budget;
  const fetch = current.createModelFetch({ timeoutMs: 600_000, fetchImpl: async (_url, init) => {
    budget = init.timeoutMs;
    return new Response('ok');
  } });
  await (await fetch('https://fixture.test', { headers: { 'X-Stainless-Timeout': '20' } })).text();
  assert.equal(budget, 20_000);
});

test('other web callers retain HTTP fallback and the short direct wait', async () => {
  const current = fixture((_url, init) => new Response('', { status: init.dispatcher.kind === 'direct' ? 503 : 200 }));
  assert.equal((await current.smartFetch('https://upstream.test')).status, 200);
  assert.deepEqual(current.attempts.map(x => x.dispatcher.kind), ['direct', 'proxy']);
  assert.deepEqual(current.timers, [3200, 8000]);
});

test('Pi-style Request inputs retain headers and a replayable body across fallback', async () => {
  const current = fixture((_url, init) => {
    if (init.dispatcher.kind === 'direct') throw connectionError();
    return new Response('ok');
  });
  const request = new Request('https://upstream.test/v1/chat/completions', {
    method: 'POST', headers: { authorization: 'Bearer fixture' }, body: '{"model":"fixture"}',
  });
  assert.equal(await (await current.createModelFetch()(request)).text(), 'ok');
  assert.equal(current.attempts.length, 2);
  for (const attempt of current.attempts) {
    assert.equal(attempt.url, request.url);
    assert.equal(attempt.method, 'POST');
    assert.equal(attempt.headers.get('authorization'), 'Bearer fixture');
    assert.equal(new TextDecoder().decode(attempt.body), '{"model":"fixture"}');
  }
});
