import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import * as authDomains from './feishu-auth-domains.mjs';

const require = createRequire(import.meta.url);
function load(path, mocks) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, URL, console, Node: globalThis.window?.Node, window: globalThis.window, document: globalThis.document, setInterval, clearInterval, setTimeout, clearTimeout, require: name => {
      if (name in mocks) return mocks[name];
      if (name === '@/lib/connectors/feishu-auth-domains.mjs') return authDomains;
      if (name === '@/lib/connectors/mail-providers.mjs') return mocks.mailProviders;
      if (name === '@/components/connectors/MailConnectorSettings') return { default: () => null };
      if (name === './ConnectorTargetSelector') return { default: load('../../components/connectors/ConnectorTargetSelector.tsx', mocks) };
      if (name === 'react' || name === 'react/jsx-runtime' || name === 'react-dom') return require(name);
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      if (name === './ConnectorDrawer') return { default: ({ children }) => React.createElement('div', { role: 'dialog' }, children) };
      if (['./FeishuMark', './FeishuAdvanced', '@/components/connectors/FeishuMark'].includes(name)) return { default: () => null };
      throw Error(name);
    },
  });
  return exports.default;
}
function dom() {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  window.open = () => null;
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  return createRoot(document.getElementById('root'));
}
async function click(label) {
  const element = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === label);
  assert.ok(element, label);
  await act(async () => element.click());
}

test('shared target selector filters names and scopes, counts all enabled entries, and preserves enable/revoke gates', async () => {
  const root = dom();
  const jsx = require('react/jsx-runtime');
  const inputs = {};
  const toggles = [];
  let retries = 0;
  const Component = load('../../components/connectors/ConnectorTargetSelector.tsx', {
    'react/jsx-runtime': { ...jsx, jsx: (type, props, key) => { if (type === 'input') inputs[props['aria-label']] = props; return jsx.jsx(type, props, key); } },
  });
  const props = { title: '选择使用入口', description: '独立开启', connectorName: '邮箱', connectorId: 'mail', canEnable: false,
    targets: [{ scope: 'assistant', scopeId: 'alice', name: '小伴', connectorIds: ['mail'] }, { scope: 'agent', scopeId: 'sunny', name: 'Sunny', connectorIds: [] }, { scope: 'space', scopeId: 'work', name: '团队工作', connectorIds: [] }],
    onToggle: target => toggles.push(target.scopeId), onRetry: () => retries++,
  };
  try {
    await act(async () => root.render(React.createElement(Component, props)));
    assert.match(document.body.textContent, /已开启 1 个/);
    assert.equal(inputs['为小伴「小伴」开启邮箱'].disabled, false, 'existing bindings may be disabled even when verification does not permit new bindings');
    assert.equal(inputs['为Agent「Sunny」开启邮箱'].disabled, true);
    await act(async () => inputs['为Agent「Sunny」开启邮箱'].onChange());
    assert.deepEqual(toggles, []);
    await act(async () => inputs['为小伴「小伴」开启邮箱'].onChange());
    assert.deepEqual(toggles, ['alice']);
    await act(async () => inputs['搜索使用入口'].onChange({ target: { value: 'sUnNy' } }));
    assert.ok(document.querySelector('[aria-label="为Agent「Sunny」开启邮箱"]'));
    assert.equal(document.querySelector('[aria-label="为小伴「小伴」开启邮箱"]'), null);
    assert.match(document.body.textContent, /已开启 1 个/);
    await act(async () => inputs['搜索使用入口'].onChange({ target: { value: '空间' } }));
    assert.ok(document.querySelector('[aria-label="为空间「团队工作」开启邮箱"]'));
    await act(async () => inputs['搜索使用入口'].onChange({ target: { value: '不存在' } }));
    assert.match(document.body.textContent, /没有匹配的入口/);
    await act(async () => inputs['搜索使用入口'].onChange({ target: { value: '' } }));
    await act(async () => root.render(React.createElement(Component, { ...props, busy: true, canEnable: true })));
    assert.equal(inputs['为小伴「小伴」开启邮箱'].disabled, true);
    assert.equal(inputs['为Agent「Sunny」开启邮箱'].disabled, true);
    await act(async () => root.render(React.createElement(Component, { ...props, error: '入口读取失败' })));
    await click('重试读取入口');
    assert.equal(retries, 1);
    assert.equal(document.querySelector('input[type=checkbox]'), null);
  } finally { await act(async () => root.unmount()); }
});

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

test('mail settings preserve saved credentials, hide passwords after save and bind only a chosen entry', async () => {
  const root = dom();
  const jsx = require('react/jsx-runtime');
  const inputs = {};
  const saves = [], bindings = [];
  let fail = false;
  const editing = { id: 'mail', toolId: 'personal-mail', name: '邮箱', catalogId: 'personal-mail' };
  const Component = load('../../components/connectors/MailConnectorSettings.tsx', {
    mailProviders: await import('./personal-mail.mjs'),
    'react/jsx-runtime': { ...jsx, jsx: (type, props, key) => { if (['input', 'select'].includes(type)) inputs[props['aria-label'] || 'replace'] = props; return jsx.jsx(type, props, key); } },
    '@/lib/client/api': { connectors: {
      targets: async () => ({ targets: [{ scope: 'agent', scopeId: 'lulu', name: '璐璐', connectorIds: [] }] }),
      mailStatus: async () => ({ provider: 'qq', email: 'alice@qq.com' }),
      save: async (...args) => { saves.push(args); return { connector: editing }; },
      test: async () => ({ ok: true }),
      bind: async (...args) => { bindings.push(args); if (fail) throw Error('入口保存失败'); },
    } },
  });
  try {
    await act(async () => root.render(React.createElement(Component, { editing, onSaved: () => {} })));
    assert.equal(document.querySelector('input[type=password]'), null);
    assert.equal(inputs['邮箱地址'].value, 'alice@qq.com');
    await click('保存配置');
    assert.equal(saves[0][0].headers, undefined);
    assert.equal(bindings.length, 0);
    await click('检测连接');
    assert.match(document.body.textContent, /只读方式打开收件箱/);
    await act(async () => inputs['为Agent「璐璐」开启邮箱'].onChange());
    assert.deepEqual(bindings[0], ['agent', 'lulu', 'mail', true]);
    assert.equal(inputs['为Agent「璐璐」开启邮箱'].checked, true);
    fail = true;
    await act(async () => inputs['为Agent「璐璐」开启邮箱'].onChange());
    assert.equal(inputs['为Agent「璐璐」开启邮箱'].checked, true);
    await act(async () => inputs.replace.onChange({ target: { checked: true } }));
    await act(async () => inputs['授权码／应用专用密码'].onChange({ target: { value: 'new-private-code' } }));
    await click('保存配置');
    assert.equal(saves[1][0].headers.password, 'new-private-code');
    assert.equal(document.querySelector('input[type=password]'), null);
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
  let appId, appSecret, authChoice, form, saves = [], actions = [], saved = 0, authorized = false;
  const capture = (type, props) => {
    if (type === 'form') form = props;
    if (type === 'input' && props.placeholder === 'cli_…') appId = props;
    if (type === 'input' && props.type === 'password') appSecret = props;
    if (type === 'input' && props['aria-label'] === '授权功能：文档') authChoice = props;
  };
  const Component = load('../../components/connectors/FeishuConnectorSettings.tsx', {
    'react/jsx-runtime': { ...jsx, jsx: (type, props, key) => {
      capture(type, props);
      return jsx.jsx(type, props, key);
    }, jsxs: (type, props, key) => { capture(type, props); return jsx.jsxs(type, props, key); } },
    '@/lib/client/api': { connectors: {
      save: async (...args) => { saves.push(args); return { connector: { id: 'one', toolId: 'feishu-cli', name: '飞书', catalogId: 'feishu-cli' } }; },
      targets: async () => ({ targets: [] }),
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
    assert.match(document.body.textContent, /3. 授权并验证连接/);
    assert.equal(document.querySelector('input[type=password]'), null);
    await act(async () => root.render(React.createElement(Component, { editing: { id: 'one', toolId: 'feishu-cli', name: '飞书' }, onSaved: () => saved++ })));
    await act(async () => authChoice.onChange());
    await click('登录授权');
    assert.equal([...document.querySelectorAll('a')].find(link => link.textContent.includes('打开飞书授权页面')).getAttribute('href'), 'https://accounts.feishu.cn/auth');
    await click('我已授权');
    assert.deepEqual(actions, ['start', 'complete']);
    assert.match(document.body.textContent, /用户身份已授权/);
    await submit();
    assert.equal(saves[1][0].headers, undefined);
  } finally { await act(async () => root.unmount()); }
});

test('Feishu settings show unavailable service without installation instructions and enable login after recheck', async () => {
  const root = dom();
  let ready = false, authReads = 0;
  const Component = load('../../components/connectors/FeishuConnectorSettings.tsx', {
    '@/lib/client/api': { connectors: {
      targets: async () => ({ targets: [] }),
      feishuRuntime: async () => ({ ready, platform: 'linux', expectedVersion: '1.0.100', cli: { message: ready ? '已安装，版本匹配' : '尚未安装飞书 CLI', version: ready ? '1.0.100' : null }, sandbox: { status: 'ready', message: 'bubblewrap 与用户命名空间可用' } }),
      feishuStatus: async () => { authReads++; return { status: {}, pending: [], bindings: [] }; },
    } },
  });
  try {
    await act(async () => root.render(React.createElement(Component, { editing: null, onSaved: () => {} })));
    assert.match(document.body.textContent, /尚未安装飞书 CLI/);
    assert.match(document.body.textContent, /飞书连接服务暂不可用，请联系管理员/);
    assert.doesNotMatch(document.body.textContent, /yarn connectors:install-feishu|安装连接组件|复制安装命令/);
    await act(async () => root.render(React.createElement(Component, { editing: { id: 'one', name: '飞书' }, onSaved: () => {} })));
    const login = () => [...document.querySelectorAll('button')].find(item => item.textContent === '登录授权');
    assert.equal(login().disabled, true);
    assert.equal(authReads, 0);
    ready = true;
    await click('重新检测');
    assert.match(document.body.textContent, /服务已就绪/);
    assert.equal(login().disabled, true); // A ready service still requires an explicit permission selection.
    assert.equal(authReads, 1);
  } finally { await act(async () => root.unmount()); }
});

const readyRuntime = { ready: true, platform: 'linux', expectedVersion: '1.0.100', cli: { status: 'ready', message: '已安装' }, sandbox: { status: 'ready', message: '隔离环境可用' } };
const existingFeishu = { id: 'one', toolId: 'feishu-cli', name: '飞书', catalogId: 'feishu-cli' };
async function feishuHarness(api = {}, editing = existingFeishu) {
  const root = dom();
  const props = new Map();
  const jsx = require('react/jsx-runtime');
  const capture = (type, value) => {
    if (type === 'form') props.set('form', value);
    if (type === 'input') props.set(value['aria-label'] || value.placeholder || value.type || 'name', value);
  };
  const Component = load('../../components/connectors/FeishuConnectorSettings.tsx', {
    'react/jsx-runtime': Object.fromEntries(Object.entries(jsx).map(([name, fn]) => ['jsx', 'jsxs'].includes(name) ? [name, (type, value, key) => { capture(type, value); return fn(type, value, key); }] : [name, fn])),
    '@/lib/client/api': { connectors: {
      targets: async () => ({ targets: [{ scope: 'assistant', scopeId: 'alice', name: '小伴', connectorIds: [] }, { scope: 'space', scopeId: 'space-a', name: '团队工作', connectorIds: [] }] }),
      feishuRuntime: async () => readyRuntime,
      feishuStatus: async () => ({ status: { botAvailable: true, userAvailable: false }, pending: [], bindings: [] }),
      save: async () => ({ connector: existingFeishu }),
      test: async () => ({ ok: true, tools: [] }),
      ...api,
    } },
  });
  const saved = [];
  const render = value => act(async () => root.render(React.createElement(Component, { editing: value, onSaved: value => saved.push(value), onClose: () => {} })));
  await render(editing);
  return { props, saved, render, close: () => act(async () => root.unmount()) };
}

test('new Feishu stays open after save, requires verification and enables only the explicitly chosen target; a failed toggle stays unchanged', async () => {
  let calls = [], fail = false;
  const h = await feishuHarness({ bind: async (...args) => { calls.push(args); if (fail) throw Error('入口保存失败'); } }, null);
  const checkbox = () => h.props.get('为小伴「小伴」开启飞书');
  try {
    assert.equal(checkbox().disabled, true);
    await act(async () => {
      h.props.get('cli_…').onChange({ target: { value: 'cli_test' } });
      h.props.get('password').onChange({ target: { value: 'private-secret' } });
    });
    await act(async () => h.props.get('form').onSubmit({ preventDefault() {} }));
    assert.equal(h.saved[0].id, 'one');
    assert.equal(document.querySelector('[role=dialog]') !== null, true);
    assert.equal(document.querySelector('input[type=password]'), null);
    assert.equal(calls.length, 0);
    assert.equal(checkbox().disabled, true);
    await click('验证连接');
    assert.equal(checkbox().disabled, false);
    assert.equal(checkbox().checked, false);
    await act(async () => checkbox().onChange());
    assert.deepEqual(calls[0], ['assistant', 'alice', 'one', true]);
    assert.equal(checkbox().checked, true);
    assert.equal(h.props.get('为空间「团队工作」开启飞书').checked, false);
    fail = true;
    await act(async () => checkbox().onChange());
    assert.equal(checkbox().checked, true);
    assert.match(document.body.textContent, /入口保存失败/);
  } finally { await h.close(); }
});

test('failed authorization closes the blank popup and supports retry with a fallback link; failed completion preserves the link', async () => {
  let failStart = true, closed = 0, navigated = [], failComplete = true;
  const h = await feishuHarness({ feishuAction: async (_id, input) => {
    if (input.action === 'start' && failStart) throw Error('授权服务暂不可用');
    if (input.action === 'complete' && failComplete) throw Error('尚未确认授权');
    return { verificationUrl: 'https://accounts.feishu.cn/auth', userCode: 'ABCD', expiresIn: 600 };
  } });
  window.open = () => ({ opener: {}, closed: false, close: () => closed++, location: { replace: url => navigated.push(url) } });
  try {
    await act(async () => h.props.get('授权功能：文档').onChange());
    await click('登录授权');
    assert.equal(closed, 1);
    assert.match(document.body.textContent, /授权服务暂不可用/);
    failStart = false;
    await click('登录授权');
    assert.deepEqual(navigated, ['https://accounts.feishu.cn/auth']);
    assert.match(document.body.textContent, /授权码：ABCD/);
    await click('我已授权');
    assert.match(document.body.textContent, /尚未确认授权/);
    assert.ok([...document.querySelectorAll('a')].find(link => link.textContent.includes('打开飞书授权页面')));
    failComplete = false;
    await click('我已授权');
    assert.doesNotMatch(document.body.textContent, /授权码：ABCD/);
  } finally { await h.close(); }
});

test('authorization popup shows progress while the link is pending and then navigates to Feishu', async () => {
  let finish;
  const navigated = [];
  const h = await feishuHarness({ feishuAction: () => new Promise(resolve => { finish = resolve; }) });
  const { document: popupDocument } = parseHTML('<html><head></head><body></body></html>');
  const popup = { document: popupDocument, opener: {}, closed: false, location: { replace: url => navigated.push(url) } };
  window.open = () => popup;
  try {
    await act(async () => h.props.get('授权功能：文档').onChange());
    await click('登录授权');
    assert.equal(popup.opener, null);
    assert.match(popupDocument.body.textContent, /正在准备飞书授权/);
    assert.match(popupDocument.body.textContent, /返回原页面查看进度或错误提示/);
    assert.equal(navigated.length, 0);
    await act(async () => finish({ verificationUrl: 'https://accounts.feishu.cn/auth', expiresIn: 600 }));
    assert.deepEqual(navigated, ['https://accounts.feishu.cn/auth']);
  } finally { await h.close(); }
});

test('popup navigation failure keeps the valid authorization link and explains how to continue', async () => {
  let closed = 0;
  const h = await feishuHarness({ feishuAction: async () => ({ verificationUrl: 'https://accounts.feishu.cn/auth', expiresIn: 600 }) });
  window.open = () => ({ opener: {}, closed: false, close: () => closed++, location: { replace: () => { throw Error('browser blocked navigation'); } } });
  try {
    await act(async () => h.props.get('授权功能：文档').onChange());
    await click('登录授权');
    assert.equal(closed, 1);
    assert.match(document.body.textContent, /自动跳转未完成，请点击「打开飞书授权页面」继续/);
    assert.ok(document.querySelector('a[href="https://accounts.feishu.cn/auth"]'));
    assert.doesNotMatch(document.body.textContent, /browser blocked navigation/);
    assert.equal(document.querySelector('[role=alert]'), null);
  } finally { await h.close(); }
});

test('expired authorization links cannot be completed and can be replaced', async () => {
  const h = await feishuHarness({ feishuAction: async () => ({ verificationUrl: 'https://accounts.feishu.cn/auth', expiresIn: -1 }) });
  try {
    await act(async () => h.props.get('授权功能：文档').onChange());
    await click('登录授权');
    assert.match(document.body.textContent, /授权链接已过期/);
    assert.equal([...document.querySelectorAll('button')].some(button => button.textContent === '我已授权'), false);
    await click('登录授权');
    assert.match(document.body.textContent, /授权链接已过期/);
  } finally { await h.close(); }
});

test('authorization requires a deliberate selection, submits only selected domains and invalidates links when selection changes', async () => {
  const requests = [];
  const h = await feishuHarness({ feishuAction: async (_id, input) => {
    requests.push(input);
    return { verificationUrl: 'https://accounts.feishu.cn/auth', expiresIn: 600 };
  } });
  const login = () => [...document.querySelectorAll('button')].find(item => item.textContent === '登录授权');
  try {
    assert.equal(login().disabled, true);
    assert.equal(requests.length, 0);
    assert.match(document.body.textContent, /联系飞书租户管理员或应用管理员/);
    await act(async () => h.props.get('授权功能：文档').onChange());
    await act(async () => h.props.get('授权功能：日历').onChange());
    await click('登录授权');
    assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ action: 'start', domains: ['docs', 'calendar'] }]);
    assert.ok(document.querySelector('a[href="https://accounts.feishu.cn/auth"]'));
    await act(async () => h.props.get('授权功能：文档').onChange());
    assert.equal(document.querySelector('a[href="https://accounts.feishu.cn/auth"]'), null);
    await click('登录授权');
    assert.deepEqual(Array.from(requests[1].domains), ['calendar']);
    await act(async () => h.props.get('授权功能：日历').onChange());
    assert.equal(login().disabled, true);
  } finally { await h.close(); }
});

test('failed verification does not unlock bindings, and changed credentials invalidate prior verification', async () => {
  let ok = false, saves = [];
  const h = await feishuHarness({ test: async () => ({ ok }), save: async input => { saves.push(input); return { connector: existingFeishu }; } });
  const checkbox = () => h.props.get('为小伴「小伴」开启飞书');
  try {
    await click('验证连接');
    assert.equal(checkbox().disabled, true);
    assert.match(document.body.textContent, /连接验证失败/);
    ok = true;
    await click('验证连接');
    assert.equal(checkbox().disabled, false);
    await act(async () => h.props.get('checkbox').onChange({ target: { checked: true } }));
    assert.equal(checkbox().disabled, true);
    await act(async () => { h.props.get('cli_…').onChange({ target: { value: 'cli_replacement' } }); h.props.get('password').onChange({ target: { value: 'new-secret' } }); });
    await act(async () => h.props.get('form').onSubmit({ preventDefault() {} }));
    assert.equal(saves[0].headers.appSecret, 'new-secret');
    assert.equal(checkbox().disabled, true);
    assert.equal(document.querySelector('input[type=password]'), null);
    assert.doesNotMatch(document.body.textContent, /连接验证通过，可选择使用入口/);
  } finally { await h.close(); }
});

test('service failures remain read-only and expose rechecking without any install action', async () => {
  let reads = 0;
  const h = await feishuHarness({
    feishuRuntime: async () => { reads++; return { ...readyRuntime, ready: false, cli: { status: 'missing', message: '尚未安装飞书 CLI' } }; },
  });
  try {
    assert.match(document.body.textContent, /飞书连接服务暂不可用，请联系管理员/);
    assert.doesNotMatch(document.body.textContent, /安装连接组件|复制安装命令|yarn connectors:install-feishu|手动安装/);
    assert.equal([...document.querySelectorAll('button')].find(button => button.textContent === '登录授权').disabled, true);
    await click('重新检测');
    assert.equal(reads, 2);
    assert.match(document.body.textContent, /服务未就绪/);
    assert.doesNotMatch(document.body.textContent, /服务已就绪/);
  } finally { await h.close(); }
});

test('a delayed status response for an old connector cannot overwrite the current connector', async () => {
  let resolveOld;
  const pending = new Promise(resolve => { resolveOld = resolve; });
  const h = await feishuHarness({ feishuStatus: id => id === 'old' ? pending : Promise.resolve({ status: { botAvailable: false, userAvailable: false } }) }, null);
  try {
    await h.render({ ...existingFeishu, id: 'old' });
    await h.render({ ...existingFeishu, id: 'new' });
    await act(async () => resolveOld({ status: { botAvailable: true, userAvailable: true } }));
    assert.match(document.body.textContent, /用户身份未授权/);
    assert.doesNotMatch(document.body.textContent, /用户身份已授权/);
  } finally { await h.close(); }
});

test('configuration drawer traps focus, blocks Escape while busy, restores focus and scroll on close', async () => {
  const root = dom();
  let active;
  Object.defineProperty(document, 'activeElement', { get: () => active, configurable: true });
  window.HTMLElement.prototype.focus = function () { active = this; this.dispatchEvent(new window.Event('focusin', { bubbles: true })); };
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  document.body.style.overflow = 'auto';
  let closed = 0;
  const Drawer = load('../../components/connectors/ConnectorDrawer.tsx', {});
  const children = React.createElement('div', null, React.createElement('h2', { id: 'feishu-drawer-title' }, '飞书'), React.createElement('button', { id: 'first' }, '第一项'), React.createElement('button', { id: 'last' }, '最后一项'));
  const render = busy => act(async () => root.render(React.createElement(Drawer, { busy, onClose: () => closed++ }, children)));
  const key = async (value, shiftKey = false) => {
    const event = new window.Event('keydown', { bubbles: true, cancelable: true });
    Object.assign(event, { key: value, shiftKey });
    await act(async () => document.dispatchEvent(event));
  };
  try {
    await render(true);
    assert.equal(document.body.style.overflow, 'hidden');
    assert.equal(active.getAttribute('role'), 'dialog');
    await key('Escape');
    assert.equal(closed, 0);
    await key('Tab');
    assert.equal(active.id, 'first');
    await key('Tab', true);
    assert.equal(active.id, 'last');
    await key('Tab');
    assert.equal(active.id, 'first');
    await act(async () => opener.focus());
    assert.equal(active.getAttribute('role'), 'dialog');
    await render(false);
    await key('Escape');
    assert.equal(closed, 1);
  } finally { await act(async () => root.unmount()); }
  assert.equal(document.body.style.overflow, 'auto');
  assert.equal(active, opener);
});

test('Feishu directory opens a drawer and retains it after saving so onboarding can continue', async () => {
  const root = dom();
  let form;
  const Component = load('../../components/connectors/ConnectorCenter.tsx', {
    '@/lib/client/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    '@/lib/connectors/catalog.mjs': await import('./catalog.mjs'),
    '@/components/mcp/McpServerManager': { default: () => null },
    '@/components/connectors/FeishuConnectorSettings': { default: props => { form = props; return React.createElement('div', { role: 'dialog' }, '飞书流程'); } },
    '@/components/shared/ConfirmDialog': { default: () => null },
    '@/lib/client/api': { connectors: { list: async () => ({ connectors: [] }), feishuRuntime: async () => readyRuntime, feishuStatus: async () => ({ status: {} }) } },
  });
  try {
    await act(async () => root.render(React.createElement(Component)));
    await click('内置连接器');
    await act(async () => document.querySelector('article button').click());
    assert.equal(form.editing, null);
    await act(async () => form.onSaved(existingFeishu));
    assert.equal(document.querySelector('[role=dialog]').textContent, '飞书流程');
    assert.equal(form.editing, null, 'parent must not remount a newly saved connector and clear in-progress authorization');
    await act(async () => form.onClose());
    assert.equal(document.querySelector('[role=dialog]'), null);
    assert.match(document.body.textContent, /已添加（1）/);
    assert.ok(document.querySelector('[aria-label="搜索内置连接器"]'), 'closing the drawer preserves the directory tab');
    await click('已添加（1）');
    await click('管理连接');
    assert.equal(form.editing.id, 'one');
  } finally { await act(async () => root.unmount()); }
});

test('verification cannot report success when the refreshed identity has become unavailable', async () => {
  let available = true;
  const h = await feishuHarness({ feishuStatus: async () => ({ status: { botAvailable: available, userAvailable: false } }) });
  try {
    available = false;
    await click('重新验证连接');
    assert.equal(h.props.get('为小伴「小伴」开启飞书').disabled, true);
    assert.match(document.body.textContent, /飞书身份未就绪/);
    assert.doesNotMatch(document.body.textContent, /连接验证通过，可选择使用入口/);
  } finally { await h.close(); }
});

test('opening an existing ready connector verifies automatically without starting login and accepts bot-only identity', async () => {
  let tests = 0, logins = 0;
  const h = await feishuHarness({
    test: async () => { tests++; return { ok: true }; },
    feishuAction: async () => { logins++; throw Error('login must stay manual'); },
    targets: async () => ({ targets: [{ scope: 'assistant', scopeId: 'alice', name: '小伴', connectorIds: ['one'] }] }),
  });
  try {
    assert.equal(tests, 1);
    assert.equal(logins, 0);
    assert.match(document.body.textContent, /已就绪/);
    assert.equal(h.props.get('为小伴「小伴」开启飞书').disabled, false);
    assert.match(document.body.textContent, /重新验证连接/);
    await click('重新检测');
    assert.equal(tests, 2);
  } finally { await h.close(); }
});

test('new or unavailable connectors never trigger automatic online verification', async () => {
  let tests = 0;
  const h = await feishuHarness({ test: async () => { tests++; return { ok: true }; } }, null);
  try { assert.equal(tests, 0); } finally { await h.close(); }
  const unavailable = await feishuHarness({ feishuRuntime: async () => ({ ...readyRuntime, ready: false }), test: async () => { tests++; return { ok: true }; } });
  try { assert.equal(tests, 0); } finally { await unavailable.close(); }
});

test('late automatic verification cannot unlock a different connector', async () => {
  let resolveOld;
  const pending = new Promise(resolve => { resolveOld = resolve; });
  const h = await feishuHarness({ test: id => id === 'old' ? pending : Promise.resolve({ ok: false }) }, null);
  try {
    await h.render({ ...existingFeishu, id: 'old' });
    await h.render({ ...existingFeishu, id: 'new' });
    await act(async () => resolveOld({ ok: true }));
    assert.equal(h.props.get('为小伴「小伴」开启飞书').disabled, true);
    assert.match(document.body.textContent, /连接验证失败/);
    assert.doesNotMatch(document.body.textContent, /连接验证通过，可选择使用入口/);
  } finally { await h.close(); }
});
