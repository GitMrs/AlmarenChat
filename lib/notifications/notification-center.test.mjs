import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
const require = createRequire(import.meta.url);
const source = await readFile(new URL('../../components/notifications/NotificationCenter.tsx', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const item = { id: 'notice', kind: 'REMINDER', title: '提交报告', content: '完整通知内容', createdAt: new Date().toISOString(), readAt: null, sourceHref: '/me?tab=assistant', deliveries: [{ channel: 'QQ', status: 'FAILED', error: '通道暂时离线' }] };
function harness(api) {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const exports = {}, polls = [];
  vm.runInNewContext(output, { exports, Date, require(name) {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (name === 'next/link') return { default: ({ children, ...props }) => React.createElement('a', props, children) };
    if (name === 'react-markdown') return { default: ({ children }) => React.createElement('div', null, children) };
    if (name === 'remark-gfm') return { default: () => {} };
    if (name === '@/lib/client/api') return { notifications: api };
    if (name === '@/lib/space/serial-polling.mjs') return { startSerialPolling(poll) { const controller = new AbortController(); polls.push({ poll, controller }); void poll(controller.signal); return () => controller.abort(); } };
    throw Error(name);
  } });
  const root = createRoot(document.getElementById('root'));
  const click = button => act(async () => button.dispatchEvent(new window.Event('click', { bubbles: true })));
  return { root, Component: exports.default, polls, click };
}

test('notification details show failure and source, reading keeps content open and read-all is explicit', async () => {
  let read = false, all = false;
  const calls = [];
  const h = harness({
    list: async filter => { calls.push(filter); return { notifications: [{ ...item, readAt: read || all ? new Date().toISOString() : null }], unread: read || all ? 0 : 1, total: 1, page: 1 }; },
    read: async id => { assert.equal(id, item.id); read = true; }, readAll: async () => { all = true; },
  });
  try {
    await act(async () => h.root.render(React.createElement(h.Component)));
    assert.equal(read, false);
    assert.match(document.body.textContent, /QQ 发送失败/);
    await h.click(document.querySelector('article button'));
    assert.equal(read, true);
    assert.match(document.body.textContent, /完整通知内容|通道暂时离线/);
    assert.equal(document.querySelector('article a').getAttribute('href'), item.sourceHref);
    assert.equal(document.querySelector('article [aria-label="未读"]'), null);
    const count = calls.length;
    await h.click(document.querySelector('[aria-label="筛选通知"] button'));
    assert.equal(calls.length, count, 'reselecting the filter preserves the loaded list');
    assert.ok(document.querySelector('article'));
  } finally { await act(async () => h.root.unmount()); }
});

test('switching unread filters aborts old requests and read-all refreshes the current list', async () => {
  let all = false, deferred;
  let count = 0;
  const h = harness({
    list: async () => {
      count++;
      if (count === 2) return new Promise(resolve => { deferred = resolve; });
      return { notifications: all ? [] : [item], unread: all ? 0 : 1, total: all ? 0 : 1, page: 1 };
    }, readAll: async () => { all = true; }, read: async () => {},
  });
  try {
    await act(async () => h.root.render(React.createElement(h.Component)));
    let pending;
    await act(async () => { pending = h.polls[0].poll(h.polls[0].controller.signal); });
    await h.click(document.querySelectorAll('[aria-label="筛选通知"] button')[1]);
    assert.equal(h.polls[0].controller.signal.aborted, true);
    await act(async () => { deferred({ notifications: [], unread: 88, total: 0, page: 1 }); await pending; });
    assert.doesNotMatch(document.body.textContent, /88/);
    const readAll = [...document.querySelectorAll('button')].find(button => button.textContent === '全部已读');
    await h.click(readAll);
    assert.equal(all, true);
    assert.match(document.body.textContent, /暂时没有未读通知/);
  } finally { await act(async () => h.root.unmount()); }
});
