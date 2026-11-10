import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual page handlers with batched state updates and a mocked SSE
// connection, so ID changes are tested across React's deferred updater callbacks.
const source = await readFile(new URL('../../app/studio/page.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['handleSend', 'handleRetryAssistantMessage', 'handleResetChat', 'handleDeleteMessage', 'handleClearQueue', 'handleInjectMessage'];
const handlers = [];
let scrollEffect;
let workspaceEffect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' &&
      node.arguments[0]?.getText(ast).includes('setRunState(null)') && node.arguments[1]?.getText(ast) === '[activeWorkspaceId]') {
    workspaceEffect = node.arguments[0].getText(ast);
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' &&
      node.arguments[0]?.getText(ast).includes('messagesEndRef.current.scrollIntoView')) {
    scrollEffect = node.arguments[0].getText(ast);
  }
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (names.includes(declaration.name.getText(ast))) handlers.push(node.getText(ast));
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(scrollEffect, 'The page scroll effect must be exercised');
assert.ok(workspaceEffect);
const compiled = ts.transpileModule(handlers.join('\n') + `\nconst runScrollEffect = ${scrollEffect};\nconst runWorkspaceEffect = ${workspaceEffect};` + '\nObject.assign(exports, { runScrollEffect, runWorkspaceEffect, ' + names.join(',') + ' });', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(initialMessages, events = []) {
  const updates = [], requests = [], alerts = [], skillRefreshes = [], runStates = [];
  const sse = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
  const context = {
    exports: {}, Date, AbortController, TextDecoder,
    messages: initialMessages, activeWorkspaceId: 'w', activeWorkspaceName: 'Workspace',
    isStreaming: false, isClearingMessages: false, isLoadingMessages: false,
    reasoningEffort: 'high', approvalMode: 'dangerous', studioConfig: {}, contextLength: 8192, input: '',
    chatRequestRef: { current: null }, isHistoryJumpNeededRef: { current: false }, textareaRef: { current: null },
    activeWorkspaceIdRef: { current: 'w' },
    followLatestRef: { current: true },
    prependedScrollDataRef: { current: null }, isPrependingRef: { current: false },
    getAuthToken: () => 'token', confirm: () => true, alert: message => alerts.push(message),
    setMessages: update => updates.push(update),
    setIsStreaming: value => { context.isStreaming = value; },
    setRunState: value => {
      context.runState = typeof value === 'function' ? value(context.runState) : value;
      runStates.push(context.runState);
    },
    setIsClearingQueue: value => { context.isClearingQueue = value; },
    setIsClearingMessages: value => { context.isClearingMessages = value; },
    setInput() {}, setHasMoreMessages() {}, setIsLoadingMoreMessages() {},
    setTotalTokens() {}, setRemainingTokens() {}, setContextLength() {},
    handleAuthFailure() {},
    loadWorkspaceMessages: async () => {},
    fetchWorkspaceSkills: id => skillRefreshes.push(id),
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      return url === '/api/studio/chat' ? new Response(sse) : Response.json({ success: true });
    },
  };
  vm.runInNewContext(compiled, context);
  return { context, requests, alerts, skillRefreshes, runStates, actions: context.exports, flush() {
    for (const update of updates.splice(0)) context.messages = typeof update === 'function' ? update(context.messages) : update;
  } };
}

test('client replaces temporary IDs and keeps streamed segments attached to their saved IDs', async () => {
  const f = fixture([], [
    { type: 'message.ids', data: { userMessageId: 'saved-user', assistantMessageId: 'saved-answer' } },
    { type: 'message.delta', data: { delta: 'first answer' } },
    { type: 'user.message_injected', data: { message: 'follow-up', userMessageId: 'injected-user', assistantMessageId: 'injected-answer' } },
    { type: 'message.delta', data: { delta: 'second answer' } },
  ]);
  await f.actions.handleSend('question');
  f.flush();
  assert.deepEqual(f.skillRefreshes, ['w']);
  assert.deepEqual(Array.from(f.context.messages, m => [m.id,m.content]), [
    ['saved-user','question'], ['saved-answer','first answer'], ['injected-user','follow-up'], ['injected-answer','second answer'],
  ]);
  await f.actions.handleDeleteMessage('saved-answer');
  assert.ok(f.requests[1].url.endsWith('?messageId=saved-answer'));
});

test('client retry sends a single retry request and replaces descendants without duplicating its question', async () => {
  const f = fixture([
    { id: 'u0', role: 'user', content: 'earlier' },
    { id: 'a0', role: 'assistant', content: 'earlier answer' },
    { id: 'u1', role: 'user', content: 'retry this question' },
    { id: 'a1', role: 'assistant', content: 'old answer' },
    { id: 'u2', role: 'user', content: 'later question' },
  ], [
    { type: 'message.ids', data: { userMessageId: 'u1', assistantMessageId: 'replacement' } },
    { type: 'message.delta', data: { delta: 'new answer' } },
  ]);
  await f.actions.handleRetryAssistantMessage('a1');
  f.flush();
  assert.equal(f.requests.length, 1);
  assert.equal(JSON.parse(f.requests[0].body).retryMessageId, 'a1');
  assert.deepEqual(Array.from(f.context.messages, m => m.id), ['u0','a0','u1','replacement']);
  assert.equal(f.context.messages.at(-1).content, 'new answer');
});

test('client clear aborts an in-flight request without appending an error after clearing', async () => {
  const f = fixture([{ id: 'old', role: 'user', content: 'old question' }]);
  f.context.fetch = async (url, options) => {
    f.requests.push({ url, ...options });
    if (url !== '/api/studio/chat') return Response.json({ success: true });
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  };
  const sending = f.actions.handleSend('question');
  await f.actions.handleResetChat();
  await sending;
  f.flush();
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.requests[1].method, 'DELETE');
  assert.equal(f.context.messages.length, 0);
  assert.equal(f.context.isStreaming, false);
  assert.equal(f.context.isClearingMessages, false);
  assert.equal(f.alerts.length, 0);
  assert.equal(f.skillRefreshes.length, 0);
});

test('streamed updates respect history navigation and resume following when back at the bottom', () => {
  const f = fixture([{ id: 'u', role: 'user', content: 'question' }]);
  const scrolls = [];
  f.context.messagesEndRef = { current: { scrollIntoView: options => scrolls.push(options) } };
  f.context.isHistoryJumpNeededRef.current = false;
  f.context.followLatestRef.current = false;
  f.context.isStreaming = true;
  f.actions.runScrollEffect();
  assert.equal(scrolls.length, 0);
  f.context.followLatestRef.current = true;
  f.actions.runScrollEffect();
  assert.equal(scrolls.length, 1);
  assert.equal(scrolls[0].behavior, 'auto');
});

test('client keeps queued messages out of chat and retains compression notices after the run ends', async () => {
  const f = fixture([], [
    { type: 'run.started', data: { runId: 'r' } },
    { type: 'run.status', data: { runId: 'r', status: 'waiting_confirmation' } },
    { type: 'queue.updated', data: { runId: 'r', steering: ['queued only'], followUp: ['later'] } },
    { type: 'run.status', data: { runId: 'old', status: 'responding' } },
    { type: 'run.status', data: { runId: 'r', status: 'compacting' } },
    { type: 'run.notice', data: { message: '上下文压缩失败：test' } },
  ]);
  await f.actions.handleSend('question'); f.flush();
  assert.equal(f.context.messages.length, 2);
  assert.ok(!f.context.messages.some(message => message.content === 'queued only'));
  assert.ok(f.runStates.some(run => run?.steering[0] === 'queued only' && run.status === 'waiting_confirmation'));
  assert.ok(!f.runStates.some(run => run?.status === 'responding'));
  assert.equal(f.context.runState.status, 'ended');
  assert.equal(f.context.runState.steering.length, 0);
  assert.ok(f.context.runState.notice.includes('压缩失败'));
  assert.equal(f.context.isStreaming, false);
});

test('clear sends workspace and run identity, waits for SSE, and handles rejection without deleting visible input', async () => {
  const f = fixture([]);
  f.context.chatRequestRef.current = new AbortController();
  f.context.runState = { runId: 'r', steering: ['pending'], followUp: [], status: 'running' };
  f.context.isClearingQueue = false;
  await f.actions.handleClearQueue();
  assert.equal(f.requests[0].method, 'DELETE');
  assert.deepEqual(JSON.parse(f.requests[0].body), { workspaceId: 'w', runId: 'r' });
  assert.deepEqual(f.context.runState.steering, ['pending'], 'HTTP response cannot overwrite a newer queue snapshot');
  assert.equal(f.context.isClearingQueue, false);
  f.context.fetch = async () => Response.json({ error: 'Pi rejected clear' }, { status: 500 });
  await f.actions.handleClearQueue();
  assert.ok(f.alerts[0].includes('Pi rejected clear'));
  assert.deepEqual(f.context.runState.steering, ['pending']);
});

test('single cancellation sends the stable item ID and reports a delivery race without removing other input', async () => {
  const f = fixture([]);
  f.context.chatRequestRef.current = new AbortController();
  f.context.runState = { runId: 'r', steering: [], followUp: ['same', 'same'], items: [
    { id: 'first', message: 'same', mode: 'followUp' }, { id: 'second', message: 'same', mode: 'followUp' },
  ] };
  f.context.isClearingQueue = false;
  await f.actions.handleClearQueue('second');
  assert.deepEqual(JSON.parse(f.requests[0].body), { workspaceId: 'w', runId: 'r', itemId: 'second' });
  assert.equal(f.context.runState.items.length, 2, 'Only SSE may change the queue snapshot');
  f.context.fetch = async () => Response.json({ error: '这条消息已开始处理或已移出队列，无法撤回' }, { status: 409 });
  await f.actions.handleClearQueue('first');
  assert.ok(f.alerts[0].includes('无法撤回'));
  assert.equal(f.context.runState.items[1].id, 'second');
});

test('switching workspaces aborts the old stream and ignores late queue-operation responses', async () => {
  const f = fixture([]);
  const old = new AbortController();
  f.context.chatRequestRef.current = old;
  f.context.runState = { runId: 'r', steering: ['pending'], followUp: [] };
  f.context.isClearingQueue = false;
  let reply;
  f.context.fetch = async () => new Promise(resolve => { reply = resolve; });
  const clearing = f.actions.handleClearQueue();
  const cleanup = f.actions.runWorkspaceEffect();
  cleanup();
  assert.equal(old.signal.aborted, true);
  assert.equal(f.context.chatRequestRef.current, null);
  assert.equal(f.context.runState, null);
  assert.equal(f.context.isStreaming, false);
  f.context.activeWorkspaceIdRef.current = 'other';
  f.context.isClearingQueue = true;
  reply(Response.json({ error: 'old task finished' }, { status: 409 }));
  await clearing;
  assert.equal(f.alerts.length, 0);
  assert.equal(f.context.isClearingQueue, true, 'An old response cannot change the new workspace state');
});

test('submission waits for server acceptance without creating speculative chat messages', async () => {
  const f = fixture([]);
  f.context.chatRequestRef.current = new AbortController();
  f.context.runState = { runId: 'r' };
  f.context.deliveryMode = 'followUp';
  f.context.fetch = async (url, options) => {
    f.requests.push({ url, ...options });
    return Response.json({ accepted: true, disposition: 'queued' });
  };
  await f.actions.handleInjectMessage('later task'); f.flush();
  assert.equal(f.context.messages.length, 0);
  assert.deepEqual(JSON.parse(f.requests[0].body), { workspaceId: 'w', runId: 'r', message: 'later task', mode: 'followUp' });
});
