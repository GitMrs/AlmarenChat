import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';

// Run the installed CLI and our real approval extension against a local fake
// model endpoint. No external provider, credentials, or model usage is needed.
for (const approve of [true, false]) {
  test(`Pi RPC ${approve ? 'approves' : 'rejects'} a write through the Studio extension`, { timeout: 30000 }, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'studio-pi-rpc-'));
    const configDir = path.join(root, 'config');
    await mkdir(configDir);
    let child;
    let exited;
    const proxySockets = new Set();
    let proxyConnections = 0;
    const proxy = createServer();
    t.after(async () => {
      if (child?.exitCode === null && !child.signalCode) child.kill();
      if (exited) await exited;
      for (const socket of proxySockets) socket.destroy();
      proxy.closeAllConnections();
      proxy.close();
      server.closeAllConnections();
      server.close();
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    });
    const requests = [];
    const server = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      requests.push(JSON.parse(body));
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const toolCall = requests.length === 1;
      const delta = toolCall ? {
        role: 'assistant', tool_calls: [{ index: 0, id: 'call-write', type: 'function', function: {
          name: 'write', arguments: JSON.stringify({ path: 'approved.txt', content: 'approved write' }),
        } }],
      } : { role: 'assistant', content: 'finished' };
      const packet = (delta, finish_reason = null) => ({
        id: 'local-completion', object: 'chat.completion.chunk', created: 1, model: 'studio-test',
        choices: [{ index: 0, delta, finish_reason }],
      });
      response.write(`data: ${JSON.stringify(packet(delta))}\n\n`);
      response.end(`data: ${JSON.stringify({ ...packet({}, toolCall ? 'tool_calls' : 'stop'), usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    proxy.on('request', (request, response) => {
      // Undici supports both forward HTTP proxy requests and CONNECT tunnels.
      proxyConnections += 1;
      const target = new URL(request.url);
      assert.equal(target.hostname, 'studio-model.invalid');
      const upstream = httpRequest({
        hostname: '127.0.0.1', port: server.address().port,
        method: request.method, path: target.pathname, headers: request.headers,
      }, result => { response.writeHead(result.statusCode, result.headers); result.pipe(response); });
      upstream.on('error', () => response.destroy());
      request.pipe(upstream);
    });
    proxy.on('connection', socket => { proxySockets.add(socket); socket.on('close', () => proxySockets.delete(socket)); });
    proxy.on('connect', (request, socket, head) => {
      assert.equal(request.url, 'studio-model.invalid:80');
      proxyConnections += 1;
      const upstream = net.connect(server.address().port, '127.0.0.1', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(socket); socket.pipe(upstream);
      });
      socket.on('close', () => upstream.destroy());
      upstream.on('error', () => socket.destroy());
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    await writeFile(path.join(configDir, 'models.json'), JSON.stringify({ providers: { custom: {
      baseUrl: 'http://studio-model.invalid/v1', api: 'openai-completions', apiKey: 'local-test-key',
      models: [{ id: 'studio-test', name: 'Studio test', reasoning: false, input: ['text'], contextWindow: 8192, maxTokens: 1024 }],
    } } }));
    await writeFile(path.join(configDir, 'settings.json'), JSON.stringify({ cacheWarming: 'off', retry: { enabled: false } }));
    const skillDir = path.join(configDir, 'skills/smoke-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: smoke-skill\ndescription: studio-rpc-test-skill\n---\nUse the workspace skill.');
    // The version-3 format already written by Studio must remain resumable.
    const timestamp = Date.now();
    await writeFile(path.join(root, 'session.jsonl'), [
      { type: 'session', version: 3, id: 'prior-session', timestamp: new Date(timestamp).toISOString(), cwd: root },
      { type: 'model_change', id: 'model', parentId: null, timestamp, provider: 'custom', modelId: 'studio-test' },
      { type: 'message', id: 'prior-user', parentId: 'model', timestamp,
        message: { role: 'user', content: [{ type: 'text', text: 'prior-studio-history' }], timestamp } },
      { type: 'message', id: 'prior-assistant', parentId: 'prior-user', timestamp,
        message: { role: 'assistant', content: [{ type: 'text', text: 'prior-answer' }], api: 'openai-completions',
          provider: 'custom', model: 'studio-test', stopReason: 'stop', timestamp,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } } },
    ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
    const cli = path.resolve('node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
    const extension = path.resolve('docker/studio-agent/extensions/approval.ts');
    child = spawn(process.execPath, [cli, '--mode', 'rpc', '--provider', 'custom', '--model', 'studio-test',
      '--session', path.join(root, 'session.jsonl'), '--no-skills', '--skill', path.join(skillDir, 'SKILL.md'), '--no-prompt-templates', '--no-context-files',
      '--no-extensions', '--extension', extension,
      '--extension', path.resolve('lib/coding-agents/extensions/model-network.ts')], {
      cwd: root, windowsHide: true,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: tmpdir(), HOME: root,
        PI_CODING_AGENT_DIR: configDir, PI_OFFLINE: '1', STUDIO_APPROVAL_MODE: 'always',
        HTTPS_PROXY: `http://127.0.0.1:${proxy.address().port}` },
    });
    exited = once(child, 'exit');
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const events = [];
    const pendingCommands = new Map();
    const command = (type, message) => new Promise((resolve, reject) => {
      const id = `queue-${pendingCommands.size}-${events.length}`;
      pendingCommands.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, type, message })}\n`);
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error(`Pi RPC timed out: ${stderr}\n${JSON.stringify(events)}`)), 20000);
      child.once('exit', code => { clearTimeout(timeout); reject(Error(`Pi exited ${code}: ${stderr}`)); });
      createInterface({ input: child.stdout }).on('line', line => {
        let event;
        try { event = JSON.parse(line); } catch { return; }
        events.push(event);
        if (event.type === 'response' && pendingCommands.has(event.id)) {
          const pending = pendingCommands.get(event.id);
          pendingCommands.delete(event.id);
          if (event.success) pending.resolve(event.data);
          else pending.reject(Error(event.error));
        }
        if (event.type === 'extension_ui_request' && event.method === 'confirm') {
          (async () => {
            if (approve) {
              // Keep the real CLI blocked on approval while inspecting and clearing both queues.
              // Pi 1.5.1 acknowledges these commands without a data payload;
              // Studio normalizes a successful empty acknowledgement to queued.
              assert.equal((await command('steer', 'cancel-steering-input'))?.disposition || 'queued', 'queued');
              assert.equal((await command('follow_up', 'cancel-follow-up-input'))?.disposition || 'queued', 'queued');
              assert.deepEqual(await command('clear_queue'), {
                steering: ['cancel-steering-input'], followUp: ['cancel-follow-up-input'],
              });
              assert.equal((await command('follow_up', 'retained-follow-up-input'))?.disposition || 'queued', 'queued');
            }
            child.stdin.write(`${JSON.stringify({ type: 'extension_ui_response', id: event.id, confirmed: approve })}\n`);
          })().catch(error => { clearTimeout(timeout); reject(error); });
        }
        if (event.type === 'agent_settled') { clearTimeout(timeout); resolve(); }
      });
      child.stdin.write(`${JSON.stringify({ type: 'prompt', message: 'Write approved.txt, then report finished.' })}\n`);
    });
    const started = events.findIndex(event => event.type === 'tool_execution_start');
    const confirmation = events.findIndex(event => event.type === 'extension_ui_request' && event.method === 'confirm');
    assert.ok(started >= 0 && confirmation > started, 'Studio must receive the tool arguments before the approval prompt');
    assert.equal(events[started].args.path, 'approved.txt');
    assert.ok(events.some(event => event.type === 'message_update' && event.assistantMessageEvent?.delta === 'finished'));
    assert.equal(requests.length, approve ? 3 : 2);
    assert.ok(proxyConnections > 0, 'The real Pi CLI must reach the model through the local test proxy');
    if (approve) {
      const delivered = events.findIndex(event => event.type === 'message_start' && event.message.role === 'user'
        && JSON.stringify(event.message.content).includes('retained-follow-up-input'));
      assert.ok(delivered >= 0);
      assert.ok(JSON.stringify(requests.at(-1).messages).includes('retained-follow-up-input'));
      assert.ok(!JSON.stringify(requests).includes('cancel-steering-input'));
      assert.ok(!JSON.stringify(requests).includes('cancel-follow-up-input'));
      const session = await readFile(path.join(root, 'session.jsonl'), 'utf8');
      assert.ok(!session.includes('cancel-steering-input'));
      assert.ok(!session.includes('cancel-follow-up-input'));
    }
    assert.ok(JSON.stringify(requests[0].messages).includes('studio-rpc-test-skill'), 'Explicit workspace skills must be exposed to the model');
    assert.ok(JSON.stringify(requests[0].messages).includes('prior-studio-history'), 'Existing version-3 session history must survive the upgrade');
    if (approve) assert.equal(await readFile(path.join(root, 'approved.txt'), 'utf8'), 'approved write');
    else await assert.rejects(readFile(path.join(root, 'approved.txt')), { code: 'ENOENT' });
  });
}
