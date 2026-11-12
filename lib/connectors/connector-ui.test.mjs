import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';

const require = createRequire(import.meta.url);
function load(path, mocks) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, URL, console, require: name => {
      if (name in mocks) return mocks[name];
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      throw Error(name);
    },
  });
  return exports.default;
}
function dom() {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  return createRoot(document.getElementById('root'));
}
async function click(label) {
  const element = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === label);
  assert.ok(element, label);
  await act(async () => element.click());
}

test('scope settings load only this scope and persist a deliberate toggle; failed saves do not change checked state', async () => {
  const root = dom();
  const jsx = require('react/jsx-runtime');
  let checkbox;
  let fail = false;
  const calls = [];
  const Component = load('../../components/connectors/ConnectorScopeSettings.tsx', {
    'next/link': { default: ({ children, href }) => React.createElement('a', { href }, children) },
    'react/jsx-runtime': { ...jsx, jsx: (type, props, key) => { if (type === 'input') checkbox = props; return jsx.jsx(type, props, key); } },
    '@/lib/client/api': { connectors: {
      list: async () => ({ connectors: [{ id: 'docs', name: '文档' }] }),
      bindings: async (scope, id) => { calls.push(['load', scope, id]); return { connectorIds: [] }; },
      bind: async (...args) => { calls.push(['bind', ...args]); if (fail) throw Error('保存失败'); },
    } },
  });
  try {
    await act(async () => root.render(React.createElement(Component, { scope: 'agent', scopeId: 'lulu' })));
    assert.equal(checkbox.checked, false);
    assert.deepEqual(calls, [['load', 'agent', 'lulu']]);
    await act(async () => checkbox.onChange());
    assert.equal(checkbox.checked, true);
    assert.deepEqual(calls.at(-1), ['bind', 'agent', 'lulu', 'docs', true]);
    fail = true;
    await act(async () => checkbox.onChange());
    assert.equal(checkbox.checked, true);
    assert.match(document.body.textContent, /保存失败/);
    await act(async () => root.render(React.createElement(Component, { scope: 'space', scopeId: 'space-b' })));
    assert.equal(checkbox.checked, false);
    assert.deepEqual(calls.at(-1), ['load', 'space', 'space-b']);
  } finally { await act(async () => root.unmount()); }
});

test('directory adds in its own tab, updates added status and restores add after deletion, without global toggles', async () => {
  const root = dom();
  let items = [];
  let form;
  let dialog;
  const Component = load('../../components/connectors/ConnectorCenter.tsx', {
    'lucide-react': { Blocks: () => null },
    '@/lib/client/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    '@/lib/connectors/catalog.mjs': await import('./catalog.mjs'),
    '@/components/mcp/McpServerManager': { default: props => { form = props; return React.createElement('div', null, '连接表单'); } },
    '@/components/connectors/FeishuConnectorSettings': { default: () => React.createElement('div', null, '飞书配置') },
    '@/components/shared/ConfirmDialog': { default: props => { dialog = props; return null; } },
    '@/lib/client/api': { connectors: { list: async () => ({ connectors: items }), delete: async id => { items = items.filter(item => item.id !== id); } } },
  });
  try {
    await act(async () => root.render(React.createElement(Component)));
    assert.doesNotMatch(document.body.textContent, /全局启用|停用|新增连接器/);
    await click('内置连接器');
    const add = [...document.querySelectorAll('article')].find(item => item.textContent.includes('远程 HTTP MCP')).querySelector('button');
    await act(async () => add.click());
    assert.equal(form.initialDraft.catalogId, 'http-mcp');
    assert.match(document.body.textContent, /连接表单/);
    items = [{ id: 'one', toolId: 'http-mcp', name: '文档连接', catalogId: 'http-mcp', url: 'https://example.test/mcp', hasHeaders: true }];
    await act(async () => form.onSaved());
    assert.match(document.body.textContent, /已添加（1）/);
    await click('内置连接器');
    assert.match(document.body.textContent, /已添加 · 修改配置/);
    await click('已添加（1）');
    await click('删除');
    assert.equal(dialog.open, true);
    await act(async () => dialog.onConfirm());
    await click('内置连接器');
    assert.doesNotMatch(document.body.textContent, /已添加 · 修改配置/);
  } finally { await act(async () => root.unmount()); }
});

test('Feishu form saves app credentials, preserves them on edits and completes user authorization from the connector page', async () => {
  const root = dom();
  const jsx = require('react/jsx-runtime');
  let appId, appSecret, form, saves = [], actions = [], saved = 0, authorized = false;
  const capture = (type, props) => {
    if (type === 'form') form = props;
    if (type === 'input' && props.placeholder === 'cli_…') appId = props;
    if (type === 'input' && props.type === 'password') appSecret = props;
  };
  const Component = load('../../components/connectors/FeishuConnectorSettings.tsx', {
    'react/jsx-runtime': { ...jsx, jsx: (type, props, key) => {
      capture(type, props);
      return jsx.jsx(type, props, key);
    }, jsxs: (type, props, key) => { capture(type, props); return jsx.jsxs(type, props, key); } },
    '@/lib/client/api': { connectors: {
      save: async (...args) => saves.push(args),
      feishuRuntime: async () => ({ ready: true, platform: 'win32', expectedVersion: '1.0.100', cli: { message: '已安装', version: '1.0.100' }, sandbox: { message: 'Windows 目录分离模式' } }),
      feishuStatus: async () => ({ status: { botAvailable: true, userAvailable: authorized }, bindings: [], pending: [] }),
      feishuAction: async (_id, data) => { actions.push(data.action); if (data.action === 'complete') authorized = true; return { verificationUrl: 'https://accounts.feishu.cn/auth' }; },
    } },
  });
  const submit = async () => { await act(async () => form.onSubmit({ preventDefault() {} })); };
  try {
    await act(async () => root.render(React.createElement(Component, { editing: null, onSaved: () => saved++ })));
    await act(async () => { appId.onChange({ target: { value: 'cli_test' } }); appSecret.onChange({ target: { value: 'private-secret' } }); });
    await submit();
    assert.equal(saves[0][0].catalogId, 'feishu-cli');
    assert.equal(saves[0][0].headers.appSecret, 'private-secret');
    assert.equal(saved, 1);
    await act(async () => root.render(React.createElement(Component, { editing: { id: 'one', toolId: 'feishu-cli', name: '飞书' }, onSaved: () => saved++ })));
    await click('登录授权');
    assert.equal(document.querySelector('a').getAttribute('href'), 'https://accounts.feishu.cn/auth');
    await click('我已授权');
    assert.deepEqual(actions, ['start', 'complete']);
    assert.match(document.body.textContent, /用户身份：已授权/);
    await submit();
    assert.equal(saves[1][0].headers, undefined);
  } finally { await act(async () => root.unmount()); }
});

test('Feishu settings show missing runtime before saving credentials and enable login after recheck', async () => {
  const root = dom();
  let ready = false, authReads = 0;
  const Component = load('../../components/connectors/FeishuConnectorSettings.tsx', {
    '@/lib/client/api': { connectors: {
      feishuRuntime: async () => ({ ready, platform: 'linux', expectedVersion: '1.0.100', installCommand: 'yarn connectors:install-feishu', cli: { message: ready ? '已安装，版本匹配' : '尚未安装飞书 CLI', version: ready ? '1.0.100' : null }, sandbox: { message: 'bubblewrap 与用户命名空间可用' } }),
      feishuStatus: async () => { authReads++; return { status: {}, pending: [], bindings: [] }; },
    } },
  });
  try {
    await act(async () => root.render(React.createElement(Component, { editing: null, onSaved: () => {} })));
    assert.match(document.body.textContent, /尚未安装飞书 CLI/);
    assert.match(document.body.textContent, /yarn connectors:install-feishu/);
    await act(async () => root.render(React.createElement(Component, { editing: { id: 'one', name: '飞书' }, onSaved: () => {} })));
    const login = () => [...document.querySelectorAll('button')].find(item => item.textContent === '登录授权');
    assert.equal(login().disabled, true);
    assert.equal(authReads, 0);
    ready = true;
    await click('重新检测');
    assert.match(document.body.textContent, /环境已就绪/);
    assert.equal(login().disabled, false);
    assert.equal(authReads, 1);
  } finally { await act(async () => root.unmount()); }
});
