import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React, { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { mergeMessagePage } from './message-history.mjs';

const require = createRequire(import.meta.url);
const message = (id, seconds = Number(id)) => ({ id: String(id), createdAt: new Date(1_000_000 + seconds * 1000).toISOString(), content: String(id) });

function loadHistoryHook() {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../hooks/useMessageHistory.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, AbortController, require: name => name === 'react' ? React : { mergeMessagePage } });
  return exports.useMessageHistory;
}

test('latest refresh preserves older pages, applies edits/deletions in the latest page and historical prepends do not duplicate messages', () => {
  const current = [1, 2, 3, 4].map(id => message(id));
  const latest = [{ ...message(3), content: 'edited' }, message(5)];
  const merged = mergeMessagePage(current, latest);
  assert.deepEqual(merged.map(row => row.id), ['1', '2', '3', '5']);
  assert.equal(merged[2].content, 'edited');
  assert.deepEqual(mergeMessagePage(merged, [message(0), message(1)], true).map(row => row.id), ['0', '1', '2', '3', '5']);
  assert.deepEqual(mergeMessagePage(current, []), []);
  assert.deepEqual(mergeMessagePage([message('a', 1), message('b', 1)], [message('b', 1), message('c', 1)]).map(row => row.id), ['a', 'b', 'c']);
});

test('shared history hook deduplicates requests, preserves the visible anchor, retries failures and aborts requests on scope changes', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const useMessageHistory = loadHistoryHook();
  let api, container, resolvePage, signal, calls = 0, prepends = 0;
  let fail = false;
  function Harness({ scopeId }) {
    const scrollRef = useRef(null);
    api = useMessageHistory({ scopeId, scrollRef,
      fetchPage: options => {
        calls++; signal = options.signal;
        assert.ok(options.before); assert.ok(options.beforeId);
        if (fail) return Promise.reject(Error('offline'));
        return new Promise(resolve => { resolvePage = resolve; });
      }, onBeforePrepend: () => { prepends++; },
    });
    return React.createElement('div', { ref: node => {
      scrollRef.current = node;
      if (node) { container = node; node.scrollTop ??= 0; node.getBoundingClientRect = () => ({ top: 100 }); }
    } }, api.messages.map((row, index) => React.createElement('div', {
      key: row.id, 'data-history-message-id': row.id,
      ref: node => { if (node) node.getBoundingClientRect = () => ({ top: 100 + index * 40 - container.scrollTop, bottom: 140 + index * 40 - container.scrollTop }); },
    }, row.content)));
  }
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(Harness, { scopeId: 'first' })));
    await act(async () => api.resetHistory({ messages: [message(3), message(4)], hasMore: true }));
    container.scrollTop = 20;
    let pending;
    await act(async () => { pending = api.loadMoreMessages(); void api.loadMoreMessages(); });
    assert.equal(calls, 1);
    await act(async () => api.mergeLatestPage({ messages: [message(4), message(5)] }));
    await act(async () => { resolvePage({ messages: [message(1), message(2)], hasMore: true }); await pending; });
    assert.deepEqual(Array.from(api.messages, row => row.id), ['1', '2', '3', '4', '5']);
    assert.equal(container.scrollTop, 100, 'two inserted rows keep the old visible content at the same pixel');
    assert.equal(prepends, 1);
    fail = true;
    await act(async () => api.loadMoreMessages());
    assert.equal(api.historyError, 'offline'); assert.equal(api.loadingMoreMessages, false);
    fail = false;
    await act(async () => { pending = api.loadMoreMessages(); });
    await act(async () => root.render(React.createElement(Harness, { scopeId: 'second' })));
    assert.equal(signal.aborted, true);
    await act(async () => { resolvePage({ messages: [message(0)], hasMore: true }); await pending; });
    assert.equal(api.messages.length, 0); assert.equal(api.hasMoreMessages, false);
    await act(async () => api.resetHistory({ messages: [message(8)], hasMore: false }));
    const count = calls;
    await act(async () => api.loadMoreMessages());
    assert.equal(calls, count, 'exhausted histories do not request again');
    await act(async () => api.resetHistory({ messages: [message(8)], hasMore: true }));
    await act(async () => { pending = api.loadMoreMessages(); });
    await act(async () => api.mergeLatestPage({ messages: [], hasMore: false }));
    assert.equal(signal.aborted, true, 'clearing the remote history cancels an older page in flight');
    await act(async () => { resolvePage({ messages: [message(7)], hasMore: false }); await pending; });
    assert.equal(api.messages.length, 0);
  } finally { await act(async () => root.unmount()); }
});

test('controlled history retains bootstrap messages and stream updates, resets pagination on conversation switch and ignores stale pages', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const useMessageHistory = loadHistoryHook();
  let api, setData, pendingPage, signal;
  function Harness() {
    const [data, updateData] = useState({ id: 'main', messages: [message(3), message(4)], hasMore: true });
    setData = updateData;
    const scrollRef = useRef(null);
    api = useMessageHistory({ scopeId: data.id, scrollRef, initialHasMore: data.hasMore,
      controlledState: { messages: data.messages, setMessages: update => updateData(current => current.id === data.id
        ? { ...current, messages: typeof update === 'function' ? update(current.messages) : update } : current) },
      fetchPage: options => { signal = options.signal; return new Promise(resolve => { pendingPage = resolve; }); },
      onBeforePrepend() {},
    });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(Harness)));
    assert.deepEqual(api.messages.map(row => row.id), ['3', '4']);
    assert.equal(api.hasMoreMessages, true);
    let pending;
    await act(async () => { pending = api.loadMoreMessages(); });
    await act(async () => setData(current => ({ ...current, messages: [...current.messages, message(5)] })));
    await act(async () => { pendingPage({ messages: [message(1), message(2)], hasMore: true }); await pending; });
    assert.deepEqual(Array.from(api.messages, row => row.id), ['1', '2', '3', '4', '5']);
    await act(async () => { pending = api.loadMoreMessages(); });
    await act(async () => setData({ id: 'temporary', messages: [message(9)], hasMore: false }));
    assert.equal(signal.aborted, true);
    await act(async () => { pendingPage({ messages: [message(0)], hasMore: false }); await pending; });
    assert.deepEqual(api.messages.map(row => row.id), ['9']);
    assert.equal(api.hasMoreMessages, false);
    await act(async () => api.resetHistory({ messages: [], hasMore: false }));
    assert.equal(api.messages.length, 0);
  } finally { await act(async () => root.unmount()); }
});
