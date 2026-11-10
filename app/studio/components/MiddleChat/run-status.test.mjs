import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React, { act } from 'react';
import { parseHTML } from 'linkedom';
import ts from 'typescript';

const source = await readFile(new URL('./RunStatus.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: createRequire(import.meta.url) });
const { RunStatus } = exports;

test('status panel renders lifecycle, scrollable queues, clear action, and retained compression failures', async () => {
  const { window } = parseHTML('<html><body><div id="app"></div></body></html>');
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(window.document.getElementById('app'));
  let clears = 0;
  const cancellations = [];
  const render = (extra = {}, clearing = false) => act(async () => root.render(React.createElement(RunStatus, {
    run: { runId: 'run', status: 'running', steering: [], followUp: [], ...extra }, clearing,
    onClear: () => clears++,
    onCancel: id => cancellations.push(id),
  })));
  try {
    await render();
    assert.equal(window.document.querySelector('[role="status"]').textContent, '正在执行');
    assert.equal(window.document.querySelector('button'), null);
    await render({ status: 'waiting_confirmation', steering: ['change direction'], followUp: ['next task'] });
    assert.ok(window.document.querySelector('[role="status"]').textContent.includes('等待你的确认 · 2 条消息待处理'));
    const queue = window.document.querySelector('[aria-label="待处理消息"]');
    assert.ok(queue.className.includes('overflow-y-auto'));
    assert.ok(queue.textContent.includes('立即插话：change direction'));
    assert.ok(queue.textContent.includes('结束后追加：next task'));
    await act(async () => window.document.querySelector('button').click());
    assert.equal(clears, 1);
    await render({ steering: ['change direction'] }, true);
    assert.ok(window.document.querySelector('button').hasAttribute('disabled'));
    await act(async () => window.document.querySelector('button').click());
    assert.equal(clears, 1);
    const duplicates = [
      { id: 'first', message: 'same text', mode: 'followUp' },
      { id: 'second', message: 'same text', mode: 'followUp' },
    ];
    await render({ followUp: ['same text', 'same text'], items: duplicates });
    const cancelButtons = () => Array.from(window.document.querySelectorAll('button')).filter(button => button.textContent === '取消');
    assert.equal(cancelButtons().length, 2);
    await act(async () => cancelButtons()[1].click());
    assert.deepEqual(cancellations, ['second']);
    await render({ followUp: ['same text', 'same text'], items: duplicates }, true);
    assert.ok(cancelButtons().every(button => button.hasAttribute('disabled')));
    await act(async () => cancelButtons()[0].click());
    assert.deepEqual(cancellations, ['second']);
    await render({ status: 'compacting' });
    assert.equal(window.document.querySelector('[role="status"]').textContent, '正在整理上下文');
    await render({ status: 'ended', notice: '上下文压缩失败：summary failed' });
    assert.equal(window.document.querySelector('button'), null);
    assert.ok(window.document.querySelector('[role="alert"]').textContent.includes('summary failed'));
  } finally {
    await act(async () => root.unmount());
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});
