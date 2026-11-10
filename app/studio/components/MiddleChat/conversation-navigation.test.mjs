import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import ts from 'typescript';

const nativeRequire = createRequire(import.meta.url);
async function load(name, mocks = {}) {
  const source = await readFile(new URL(name, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, console, require: (id) => id in mocks ? mocks[id] : nativeRequire(id) });
  return exports;
}
const navigation = await load('./ConversationNavigator.tsx');
const { MessageList } = await load('./MessageList.tsx', {
  './ConversationNavigator': navigation,
  './ToolCard': { ToolCard: () => null },
  'react-markdown': { __esModule: true, default: ({ children }) => React.createElement('div', { 'data-markdown': true }, children) },
  'remark-gfm': { __esModule: true, default: () => {} },
});
const message = (id, role, content = id) => ({ id, role, content, timestamp: 0 });

test('navigation groups questions with their replies and limits preview text', () => {
  const turns = navigation.buildConversationTurns([
    message('old-answer', 'assistant'), message('u1','user','question one'),
    message('a1','assistant','answer one'), message('a2','assistant','more detail'),
    message('u2','user','x'.repeat(10000)), message('a3','assistant','y'.repeat(10000)),
  ]);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].index, 1);
  assert.equal(turns[0].answer, 'answer one\nmore detail');
  assert.equal(turns[1].question.length, 300);
  assert.equal(turns[1].answer.length, 300);
});

test('a long conversation renders a bounded window of messages and navigation marks', () => {
  const messages = Array.from({ length: 10000 }, (_, i) => message(`m${i}`, i % 2 ? 'assistant' : 'user', `message ${i}`));
  const html = renderToStaticMarkup(React.createElement(MessageList, {
    messages, isLoadingMessages: false, activeWorkspaceName: 'test', onQuickPrompt() {},
    expandedToolIds: new Set(), toggleToolExpand() {}, approvingToolId: null,
    handleDecisionTool() {}, copiedToolResult: false, handleCopyToolResult() {},
    isStreaming: false, messagesEndRef: { current: null },
  }));
  const renderedRows = (html.match(/data-studio-message-id=/g) || []).length;
  const renderedMarks = (html.match(/aria-label="跳转到提问/g) || []).length;
  assert.ok(renderedRows > 0 && renderedRows < 20, `rendered ${renderedRows} of 10000 rows`);
  assert.ok(renderedMarks > 0 && renderedMarks < 80, `rendered ${renderedMarks} of 5000 marks`);
  assert.ok(!html.includes('message 9999'));
});

test('navigation previews and jumps to a virtual row that was previously unmounted', async () => {
  const { window } = parseHTML('<html><body><div id="app"></div></body></html>');
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.requestAnimationFrame = callback => setTimeout(callback, 0);
  window.cancelAnimationFrame = clearTimeout;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Object.defineProperties(window.HTMLElement.prototype, {
    scrollTop: { configurable: true, get() { return this._scrollTop || 0; }, set(value) { this._scrollTop = value; } },
    offsetHeight: { configurable: true, get() { return this.hasAttribute('data-index') ? 240 : 600; } },
    offsetWidth: { configurable: true, get() { return 800; } },
    clientHeight: { configurable: true, get() { return 600; } },
    scrollHeight: { configurable: true, get() {
      return Math.max(600, ...Array.from(this.querySelectorAll('[style]'), element => parseFloat(element.style.height) || 0)) + 48;
    } },
  });
  window.HTMLElement.prototype.getBoundingClientRect = function () { return { top: 0, left: 0, width: 800, height: this.offsetHeight, bottom: this.offsetHeight, right: 800 }; };
  window.HTMLElement.prototype.scrollTo = function ({ top }) {
    this.scrollTop = top;
    queueMicrotask(() => this.dispatchEvent(new window.Event('scroll')));
  };
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(window.document.getElementById('app'));
  const messages = Array.from({ length: 1000 }, (_, i) => message(`m${i}`, i % 2 ? 'assistant' : 'user', `message ${i}`));
  const containerRef = { current: null };
  let navigated = 0;
  try {
    await act(async () => root.render(React.createElement(MessageList, {
      messages, isLoadingMessages: false, activeWorkspaceName: 'test', onQuickPrompt() {},
      expandedToolIds: new Set(), toggleToolExpand() {}, approvingToolId: null,
      handleDecisionTool() {}, copiedToolResult: false, handleCopyToolResult() {},
      isStreaming: false, messagesEndRef: { current: null }, scrollContainerRef: containerRef,
      onNavigateHistory: () => { navigated++; },
    })));
    const marks = window.document.querySelectorAll('button[aria-label^="跳转到提问"]');
    const target = marks[marks.length - 1];
    const index = Number(target.getAttribute('aria-label').match(/message (\d+)/)[1]);
    assert.ok(!window.document.querySelector(`[data-studio-message-id="m${index}"]`));
    await act(async () => target.dispatchEvent(new window.Event('mouseover', { bubbles: true })));
    assert.ok(window.document.querySelector('[role="tooltip"]').textContent.includes(`message ${index}`));
    await act(async () => target.click());
    assert.equal(navigated, 1);
    assert.ok(window.document.querySelector(`[data-studio-message-id="m${index}"]`));
    assert.ok(window.document.querySelectorAll('[data-studio-message-id]').length < 20);
    await act(async () => containerRef.current.scrollTo({ top: containerRef.current.scrollHeight - containerRef.current.clientHeight }));
    assert.equal(window.document.querySelector('[aria-current="location"]').getAttribute('aria-label'), '跳转到提问：message 998');
    await act(async () => containerRef.current.scrollTo({ top: 0 }));
    assert.equal(window.document.querySelector('[aria-current="location"]').getAttribute('aria-label'), '跳转到提问：message 0');
  } finally {
    await act(async () => root.unmount());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});
