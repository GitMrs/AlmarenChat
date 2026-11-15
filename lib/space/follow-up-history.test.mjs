import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../../components/spaces/SpaceFollowUpHistory.tsx', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;

function harness(api) {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const exports = {};
  const controllers = [];
  vm.runInNewContext(output, { exports, console, Date, AbortController, require(name) {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === 'react-markdown') return { default: ({ children }) => React.createElement('div', null, children) };
    if (name === 'remark-gfm') return { default: () => {} };
    if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (name === '@/lib/client/api') return { spaceFollowUps: api };
    if (name === '@/lib/space/serial-polling.mjs') return { startSerialPolling(poll) {
      const controller = new AbortController(); controllers.push(controller);
      void poll(controller.signal);
      return () => controller.abort();
    } };
    throw new Error(`Unexpected import ${name}`);
  } });
  const root = createRoot(document.getElementById('root'));
  const button = text => [...document.querySelectorAll('button')].find(button => button.textContent === text);
  const click = button => act(async () => button.dispatchEvent(new window.Event('click', { bubbles: true })));
  return { root, button, click, controllers, Component: exports.default };
}

const task = (id, status = 'COMPLETED') => ({ id, title: `BTC ${id}`, agentId: 'analyst', status,
  runAt: '2026-11-15T04:05:00Z', updatedAt: 'initial', origin: 'AI_FOLLOW_UP', chainDepth: 2, maxChainDepth: 3 });

test('artifact records scope requests to the chosen work and return to dialogue without scheduling', async () => {
  const calls = [];
  let discuss = 0;
  const h = harness({ history: async (spaceId, options) => {
    calls.push([spaceId, options.workId]);
    return { tasks: [{ ...task('source-check'), workId: options.workId, workTitle: '研究报告' }], total: 1, page: 1, pageSize: 20 };
  } });
  try {
    await act(async () => h.root.render(React.createElement(h.Component, {
      spaceId: 'general', agents: [], workId: 'research', workTitle: '研究报告', onDiscussWork: () => { discuss++; },
    })));
    assert.deepEqual(calls, [['general', 'research']]);
    assert.match(document.body.textContent, /关联成果：研究报告/);
    await h.click(h.button('约定跟进'));
    assert.equal(discuss, 1);
    assert.equal(calls.length, 1, 'discussing an artifact does not create or modify any job');
    await act(async () => h.root.render(React.createElement(h.Component, { key: 'other', spaceId: 'general', agents: [], workId: 'second', workTitle: '第二份报告' })));
    assert.deepEqual(calls.at(-1), ['general', 'second']);
    assert.equal(h.controllers[0].signal.aborted, true);
    assert.match(document.body.textContent, /关联成果：第二份报告/);
  } finally { await act(async () => h.root.unmount()); }
});

test('the records area pages and filters history, loads reports on demand and cancels pending work', async () => {
  const calls = [], details = [];
  let cancelled = false;
  const h = harness({
    history: async (spaceId, options) => {
      calls.push([spaceId, options.page, options.status]);
      return { total: 41, pageSize: 20, page: options.page, tasks: options.page === 2 ? [task('older')]
        : [task('current'), task('pending', cancelled ? 'CANCELLED' : 'PENDING')] };
    },
    detail: async (_spaceId, id, signal) => {
      details.push({ id, signal });
      return { report: { content: '完整复查内容与收线证据', createdAt: '2026-11-15T04:06:00Z' } };
    },
    cancel: async (spaceId, id) => { assert.equal(spaceId, 'contract-a'); assert.equal(id, 'pending'); cancelled = true; },
  });
  try {
    await act(async () => h.root.render(React.createElement(h.Component, { spaceId: 'contract-a', agents: [{ id: 'analyst', name: '凌风' }] })));
    assert.match(document.body.textContent, /当前筛选共 41 条/);
    assert.match(document.body.textContent, /第 1 \/ 3 页/);
    assert.match(document.body.textContent, /凌风.*AI 续查 2\/3/s);
    await h.click(h.button('全部'));
    assert.match(document.body.textContent, /BTC current/);
    assert.equal(details.length, 0, 'full reports are not loaded with the list');
    await h.click(document.querySelector('[aria-label="查看跟进：BTC current"]'));
    assert.match(document.body.textContent, /完整复查内容与收线证据/);
    assert.equal(details.length, 1);
    await h.click(h.button('下一页'));
    assert.match(document.body.textContent, /BTC older/);
    assert.equal(details[0].signal.aborted, true);
    assert.deepEqual(calls.at(-1), ['contract-a', 2, 'ALL']);
    await h.click(h.button('已汇报'));
    assert.deepEqual(calls.at(-1), ['contract-a', 1, 'COMPLETED']);
    await h.click(h.button('全部'));
    await h.click(h.button('取消跟进'));
    assert.equal(cancelled, true);
    assert.equal(h.button('取消跟进'), undefined);
  } finally {
    await act(async () => h.root.unmount());
    assert.ok(h.controllers.every(controller => controller.signal.aborted));
  }
});

test('a slow result for an older filter cannot overwrite the selected records', async () => {
  let resolveOld;
  const h = harness({ history: async (_spaceId, { status }) => {
    if (status === 'ALL') return new Promise(resolve => { resolveOld = resolve; });
    return { tasks: [task('failed', 'FAILED')], total: 1, page: 1, pageSize: 20 };
  } });
  try {
    await act(async () => h.root.render(React.createElement(h.Component, { spaceId: 'contract-a', agents: [] })));
    await h.click(h.button('未完成'));
    assert.match(document.body.textContent, /BTC failed/);
    await act(async () => resolveOld({ tasks: [task('stale')], total: 1, page: 1, pageSize: 20 }));
    assert.match(document.body.textContent, /BTC failed/);
    assert.doesNotMatch(document.body.textContent, /BTC stale/);
  } finally { await act(async () => h.root.unmount()); }
});

test('settings save the selected quota for this space, explain zero and retain changes after a failed save', async () => {
  const saves = [];
  let limit = 3, fail = false;
  const h = harness({
    history: async () => ({ tasks: [], total: 0, page: 1, pageSize: 20,
      settings: { maxContinuations: limit, maxAllowedContinuations: 24 } }),
    setMaxContinuations: async (spaceId, value) => {
      saves.push([spaceId, value]);
      if (fail) throw new Error('暂时无法保存');
      limit = value;
      return { success: true, maxContinuations: value };
    },
  });
  const selectLimit = async value => {
    const select = document.querySelector('select');
    Object.defineProperty(select, 'value', { value: String(value), writable: true, configurable: true });
    await act(async () => select.dispatchEvent(new window.Event('change', { bubbles: true })));
  };
  try {
    await act(async () => h.root.render(React.createElement(h.Component, { spaceId: 'contract-a', agents: [] })));
    assert.equal(document.querySelector('select'), null, 'settings start collapsed');
    await h.click(document.querySelector('[aria-label="跟进设置"]'));
    assert.equal(document.querySelectorAll('option').length, 25);
    assert.match(document.body.textContent, /不含首次约定复查/);
    assert.equal(saves.length, 0, 'opening settings does not save or schedule anything');
    await selectLimit(6);
    assert.match(document.body.textContent, /共最多 7 次/);
    await h.click(h.button('保存设置'));
    assert.deepEqual(saves, [['contract-a', 6]]);
    assert.match(document.body.textContent, /已保存/);
    assert.match(document.body.textContent, /已有任务沿用创建时的上限/);
    fail = true;
    await selectLimit(0);
    assert.match(document.body.textContent, /只执行首次复查，不再自动续查/);
    await h.click(h.button('保存设置'));
    assert.match(document.body.textContent, /暂时无法保存/);
    assert.doesNotMatch(document.body.textContent, /已保存/);
    assert.equal(limit, 6);
    assert.equal(document.querySelector('select').value, '0');
  } finally { await act(async () => h.root.unmount()); }
});
