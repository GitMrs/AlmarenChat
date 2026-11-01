import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { channel } from 'node:diagnostics_channel';
import ts from 'typescript';
import * as gec from './edge-gec.mjs';

test('v2 signature matches reference vectors and five-minute windows', () => {
  const vectors = [
    [0, '52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6'],
    [1735689600, '54404AFE67C9B44A-E72E51D8B4F5F75E9A96B7E20D7877227455BC310433BD30C817CD54A1D9313E'],
    [1793491200, '7B4CE9D537A0C0C7-F040DBE252E495196E8C0E60525F20AF087248354D0C94DEEBA0E0BEE7D95F56'],
  ];
  for (const [time, expected] of vectors) {
    assert.equal(gec.generateSecMsGec(time), expected);
    assert.equal(gec.generateSecMsGec(time + 299.9), expected);
    assert.notEqual(gec.generateSecMsGec(time + 300), expected);
  }
  assert.throws(() => gec.generateSecMsGec(NaN), TypeError);
  assert.equal(gec.SEC_MS_GEC_VERSION, '2-143.0.3650.75');
});

// Exercise the actual transport with a fake socket; no network or global dispatcher changes.
function loadTransport(behavior, proxy = undefined) {
  const calls = [];
  const direct = { name: 'direct' };
  class Socket {
    constructor(url, options) {
      calls.push({ url, options });
      this.url = url;
      queueMicrotask(() => behavior(this));
    }
    send() {}
    close() {}
  }
  const require = createRequire(import.meta.url);
  const compiled = ts.transpileModule(fs.readFileSync(new URL('./edge-tts.mjs', import.meta.url), 'utf8'), {
    fileName: 'edge-tts.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const customRequire = name => {
    if (name === 'undici') return { WebSocket: Socket };
    if (name === './edge-gec.mjs') return gec;
    if (name === './voices.mjs') return { resolveSafeVoice: value => value || 'zh-CN-YunxiNeural' };
    if (name === '../web/proxy.ts') return {
      getDirectAgent: () => direct, getProxyAgent: async () => proxy,
      getDetectedProxyInfo: async () => ({ proxyUrl: 'http://test.invalid' }),
    };
    return require(name);
  };
  new Function('require', 'module', 'exports', compiled)(customRequire, module, module.exports);
  return { ...module.exports, calls, direct };
}

test('403 is exposed and does not trigger proxy retries', async () => {
  const transport = loadTransport(socket => {
    channel('undici:request:headers').publish({ request: { path: new URL(socket.url).search }, response: { statusCode: 403 } });
    socket.onerror({ message: 'Received network error or non-101 status code.' });
  }, { name: 'proxy' });
  await assert.rejects(transport.synthesizeEdgeTTS('测试'), error => error.status === 403 && error.code === 'TTS_HANDSHAKE_FORBIDDEN');
  assert.equal(transport.calls.length, 1);
});

test('complete audio uses v2 authentication and a request-scoped dispatcher', async () => {
  const transport = loadTransport(socket => {
    socket.onopen();
    socket.onmessage({ data: Buffer.from([0, 0, 1, 2, 3]) });
    socket.onmessage({ data: 'Path:turn.end' });
  });
  assert.deepEqual(await transport.synthesizeEdgeTTS('测试'), Buffer.from([1, 2, 3]));
  const { url, options } = transport.calls[0];
  assert.match(new URL(url).searchParams.get('Sec-MS-GEC'), /^[A-F0-9]{16}-[A-F0-9]{64}$/);
  assert.equal(new URL(url).searchParams.get('Sec-MS-GEC-Version'), gec.SEC_MS_GEC_VERSION);
  assert.equal(options.dispatcher, transport.direct);
  assert.ok(options.headers.Origin);
});

test('partial audio followed by premature close is rejected', async () => {
  const transport = loadTransport(socket => {
    socket.onopen();
    socket.onmessage({ data: Buffer.from([0, 0, 1, 2, 3]) });
    socket.onclose({ code: 1006 });
  });
  await assert.rejects(transport.synthesizeEdgeTTS('测试'), /closed before turn.end/);
});

test('direct handshake deadline does not cut off ongoing synthesis', async () => {
  const transport = loadTransport(socket => {
    socket.onopen();
    setTimeout(() => {
      socket.onmessage({ data: Buffer.from([0, 0, 1, 2, 3]) });
      socket.onmessage({ data: 'Path:turn.end' });
    }, 3600);
  }, { name: 'proxy' });
  assert.equal((await transport.synthesizeEdgeTTS('测试', { timeoutMs: 6000 })).length, 3);
  assert.equal(transport.calls.length, 1);
});
