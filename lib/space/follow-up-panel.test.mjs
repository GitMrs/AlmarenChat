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
const source = await readFile(new URL('../../components/spaces/SpaceFollowUpPanel.tsx', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;

test('the war-room switch starts off, controls only its space, and exposes cancellation without automatically creating tasks', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const calls = [];
  let state = { enabled: false, schedulerEnabled: true, qqEnabled: false, qqChannel: { ready: true, reason: '复用现有QQ' }, tasks: [] };
  let refresh, signal;
  let callbackAttempts = 0;
  let resultSignal;
  let streaming = false;
  const exports = {};
  vm.runInNewContext(output, { exports, console, require(name) {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (name === '@/lib/space/serial-polling.mjs') return { startSerialPolling(poll, options) {
      assert.equal(options.immediate, true);
      const controller = new AbortController(); signal = controller.signal;
      refresh = () => poll(signal);
      void refresh();
      return () => controller.abort();
    } };
    if (name === '@/lib/client/api') return { spaceFollowUps: {
      list: async spaceId => { assert.equal(spaceId, 'contract-a'); return structuredClone(state); },
      setEnabled: async (spaceId, enabled) => { calls.push(['toggle', spaceId, enabled]); state.enabled = enabled; },
      setQQEnabled: async (spaceId, enabled) => { calls.push(['qq-toggle', spaceId, enabled]); state.qqEnabled = enabled; },
      cancel: async (spaceId, id) => { calls.push(['cancel', spaceId, id]); state.tasks[0].status = 'CANCELLED'; },
    } };
    throw Error(`Unexpected import ${name}`);
  } });
  const root = createRoot(document.getElementById('root'));
  const props = {
    spaceId: 'contract-a', showControl: true, refreshKey: 'initial',
    onResults: async (signal) => { resultSignal = signal; callbackAttempts++; return !streaming; },
  };
  try {
    await act(async () => root.render(React.createElement(exports.default, props)));
    const toggle = document.querySelector('[role="switch"]');
    assert.equal(toggle.getAttribute('aria-checked'), 'false');
    assert.equal(calls.length, 0, 'opening the center must not enable or schedule anything');
    assert.doesNotMatch(document.body.textContent, /最多续查|复用现有/);
    const settings = document.querySelector('[aria-label="自主复查设置"]');
    assert.equal(settings.getAttribute('aria-expanded'), 'false');
    await act(async () => settings.dispatchEvent(new window.Event('click', { bubbles: true })));
    assert.match(document.body.textContent, /最多续查 3 次、持续 24 小时/);
    assert.match(document.body.textContent, /关闭会取消未完成复查/);
    await act(async () => settings.dispatchEvent(new window.Event('click', { bubbles: true })));
    assert.doesNotMatch(document.body.textContent, /最多续查/);
    assert.equal(calls.length, 0, 'opening settings is read-only');
    await act(async () => toggle.dispatchEvent(new window.Event('click', { bubbles: true })));
    assert.deepEqual(calls[0], ['toggle', 'contract-a', true]);
    assert.equal(toggle.getAttribute('aria-checked'), 'true');
    const qqToggle = document.querySelector('[aria-label="鹰眼重要变化QQ通知"]');
    assert.equal(qqToggle.getAttribute('aria-checked'), 'false', 'autonomy must not implicitly enable QQ notifications');
    await act(async () => qqToggle.dispatchEvent(new window.Event('click', { bubbles: true })));
    assert.deepEqual(calls[1], ['qq-toggle', 'contract-a', true]);
    assert.equal(qqToggle.getAttribute('aria-checked'), 'true');
    await act(async () => root.render(React.createElement(exports.default, { ...props, showControl: false })));
    assert.equal(document.querySelector('section'), null, 'chat with no pending work must not reserve panel space');
    state.tasks = [{ id: 'task-a', title: 'BTC 收线复查', status: 'PENDING', runAt: '2026-11-14T13:00:00Z', updatedAt: 'initial' }];
    await act(async () => refresh());
    assert.match(document.body.textContent, /待复查 1 项/);
    assert.match(document.body.textContent, /下次/);
    assert.equal(document.querySelector('[role="switch"]'), null, 'chat only shows pending work, without settings controls');
    await act(async () => root.render(React.createElement(exports.default, props)));
    const expand = [...document.querySelectorAll('button')].find(button => button.textContent.includes('复查记录'));
    await act(async () => expand.dispatchEvent(new window.Event('click', { bubbles: true })));
    assert.match(document.body.textContent, /BTC 收线复查/);
    const cancel = document.querySelector('button[title="取消这次复查"]');
    await act(async () => cancel.dispatchEvent(new window.Event('click', { bubbles: true })));
    assert.deepEqual(calls[2], ['cancel', 'contract-a', 'task-a']);
    await act(async () => root.render(React.createElement(exports.default, { ...props, showControl: false })));
    assert.equal(document.querySelector('section'), null, 'chat collapses again once the last pending task is cancelled');
    state.tasks[0].status = 'COMPLETED'; state.tasks[0].updatedAt = 'completed';
    streaming = true;
    await act(async () => refresh());
    assert.equal(callbackAttempts, 1);
    streaming = false;
    await act(async () => refresh());
    assert.equal(callbackAttempts, 2, 'a result deferred during streaming must be refreshed afterwards');
    await act(async () => refresh());
    assert.equal(callbackAttempts, 2, 'a delivered result must not repeatedly refresh the conversation');
  } finally {
    await act(async () => root.unmount());
    assert.equal(signal.aborted, true);
    assert.equal(resultSignal.aborted, true, 'navigating away must also abort the result-message refresh');
  }
});

test('an older polling response cannot turn the switch back on after the user closes it', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const state = { enabled: true, schedulerEnabled: true, qqEnabled: false, qqChannel: { ready: true, reason: '' }, tasks: [] };
  let refresh, deferPoll = false, finishPoll;
  const exports = {};
  vm.runInNewContext(output, { exports, console, require(name) {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (name === '@/lib/space/serial-polling.mjs') return { startSerialPolling(poll) {
      const controller = new AbortController();
      refresh = () => poll(controller.signal);
      void refresh();
      return () => controller.abort();
    } };
    if (name === '@/lib/client/api') return { spaceFollowUps: {
      list: async () => {
        const snapshot = structuredClone(state);
        if (!deferPoll) return snapshot;
        deferPoll = false;
        return new Promise(resolve => { finishPoll = () => resolve(snapshot); });
      },
      setEnabled: async (_spaceId, enabled) => { state.enabled = enabled; },
    } };
    throw Error(`Unexpected import ${name}`);
  } });
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(exports.default, {
      spaceId: 'contract-a', showControl: true, refreshKey: 'initial', onResults: async () => true,
    })));
    const toggle = document.querySelector('[aria-label="自主复查与汇报"]');
    assert.equal(toggle.getAttribute('aria-checked'), 'true');
    let pending;
    deferPoll = true;
    await act(async () => { pending = refresh(); });
    await act(async () => toggle.dispatchEvent(new window.Event('click', { bubbles: true })));
    assert.equal(toggle.getAttribute('aria-checked'), 'false');
    await act(async () => { finishPoll(); await pending; });
    assert.equal(toggle.getAttribute('aria-checked'), 'false', 'polling before the mutation must not overwrite its result');
  } finally { await act(async () => root.unmount()); }
});
