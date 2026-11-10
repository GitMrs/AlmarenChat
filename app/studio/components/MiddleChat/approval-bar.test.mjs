import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import ts from 'typescript';

const source = await readFile(new URL('./ApprovalBar.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: createRequire(import.meta.url) });
const { ApprovalBar } = exports;
const tool = (id, args) => ({ id, approvalId: `approval-${id}`, name: 'bash', preview: 'run command', status: 'waiting_approval', args });
const message = tools => ({ id: 'assistant', role: 'assistant', timestamp: 0, tools });

test('approval bar is absent when no actionable approval is pending', () => {
  const messages = [message([
    { ...tool('done'), status: 'done' },
    { ...tool('missing-id'), approvalId: undefined },
  ])];
  assert.equal(renderToStaticMarkup(React.createElement(ApprovalBar, { messages, approvingToolId: null, onDecision() {} })), '');
});

test('approval bar reviews full parameters, submits the matching action and advances through pending tools', async () => {
  const { window } = parseHTML('<html><body><div id="app"></div></body></html>');
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(window.document.getElementById('app'));
  const decisions = [];
  const first = tool('first', { command: 'npm test', content: `${'x'.repeat(2000)}END-OF-CONTENT` });
  const second = tool('second', { command: 'npm run build' });
  const onDecision = (...args) => decisions.push(args);
  const render = (tools, approvingToolId = null) => act(async () => root.render(
    React.createElement(ApprovalBar, { messages: [message(tools)], approvingToolId, onDecision })
  ));
  const button = text => Array.from(window.document.querySelectorAll('button')).find(element => element.textContent.includes(text));
  try {
    await render([first, second]);
    assert.ok(window.document.querySelector('[role="status"]').textContent.includes('还有 1 项'));
    assert.ok(window.document.body.textContent.includes('npm test'));
    assert.equal(window.document.querySelector('pre'), null);
    await act(async () => button('查看详情').click());
    assert.ok(window.document.querySelector('pre').textContent.endsWith('END-OF-CONTENT"\n}'));
    await act(async () => button('批准执行').click());
    assert.deepEqual(decisions, [['approval-first', 'approve', 'first']]);
    await render([first, second], 'approval-first');
    assert.ok(button('拒绝').hasAttribute('disabled'));
    assert.ok(button('处理中').hasAttribute('disabled'));
    await render([{ ...first, status: 'running' }, second]);
    assert.ok(window.document.body.textContent.includes('npm run build'));
    assert.equal(window.document.querySelector('pre'), null);
    await act(async () => button('拒绝').click());
    assert.deepEqual(decisions[1], ['approval-second', 'deny', 'second']);
    await render([{ ...first, status: 'done' }, { ...second, status: 'denied' }]);
    assert.equal(window.document.querySelector('section'), null);
  } finally {
    await act(async () => root.unmount());
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});
