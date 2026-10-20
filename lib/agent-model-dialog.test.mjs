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

test('the shared model dialog loads role defaults, tests inheritance and keeps space saves scoped', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root'));
  const source = await readFile(new URL('../components/spaces/SpaceMemberModelDialog.tsx', import.meta.url), 'utf8');
  const exports = {};
  const calls = [];
  const saved = [];
  const agent = { id: 'fx-kurumi', name: '久留美' };
  let picker;
  let failLoad = false;
  const profile = {
    settings: { modelName: 'role-b', apiBaseUrl: 'https://role.test/v1', apiKey: 'role-key' },
    inherited: { modelName: 'global-a', apiBaseUrl: 'https://global.test/v1', source: 'GLOBAL' },
    effective: { modelName: 'role-b', apiBaseUrl: 'https://role.test/v1', source: 'AGENT' },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, console,
    require(name) {
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      if (name.endsWith('/Avatar')) return { default: () => null };
      if (name.endsWith('/ModelPicker')) return { default: props => { picker = props; return React.createElement('input', { 'aria-label': '模型名称', value: props.value, readOnly: true }); } };
      if (name === '@/lib/api') return {
        agents: { modelSettings: async id => { assert.equal(id, agent.id); if (failLoad) throw Error('load failed'); return profile; } },
        user: { testModel: async options => { calls.push(options); return { message: '连接成功' }; } },
      };
      throw Error(name);
    },
  });
  const Component = exports.default;
  const render = props => act(async () => root.render(React.createElement(Component, {
    open: true, agent, member: null, scope: 'agent', onClose() {}, onSave: async data => { saved.push(JSON.parse(JSON.stringify(data))); }, ...props,
  })));
  const click = label => {
    const button = [...document.querySelectorAll('button')].find(element => element.textContent.trim() === label);
    assert.ok(button, label);
    return act(async () => button.click());
  };
  try {
    await render({});
    assert.match(document.body.textContent, /角色默认模型配置/);
    assert.match(document.body.textContent, /继承来源：个人全局 · global-a/);
    assert.equal(picker.value, 'role-b');
    assert.equal(picker.inheritAgentModel, false);
    assert.equal(document.querySelector('input[type="url"]').value, 'https://role.test/v1');
    await click('测试连接');
    assert.equal(calls.at(-1).agentId, agent.id);
    assert.equal(calls.at(-1).inheritAgentModel, false);
    await act(async () => picker.onChange('role-d'));
    await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(saved.at(-1).modelName, 'role-d');
    await click('恢复继承全局默认');
    assert.deepEqual(saved.at(-1), { modelName: null, apiBaseUrl: null, apiKey: null });
    const member = { agentId: agent.id, modelName: 'space-c', apiBaseUrl: null, apiKey: null };
    await render({ scope: 'space', member });
    assert.match(document.body.textContent, /只影响当前空间/);
    assert.match(document.body.textContent, /继承来源：角色默认 · role-b/);
    assert.equal(picker.value, 'space-c');
    assert.equal(picker.inheritAgentModel, true);
    await click('测试连接');
    assert.equal(calls.at(-1).apiKey, '');
    assert.equal(calls.at(-1).inheritAgentModel, true);
    await click('恢复继承角色默认');
    assert.deepEqual(saved.at(-1), { modelName: null, apiBaseUrl: null, apiKey: null });
    await render({ open: false });
    failLoad = true;
    await render({});
    assert.match(document.body.textContent, /load failed/);
    assert.ok([...document.querySelectorAll('button')].find(button => button.textContent.includes('保存配置')).disabled);
  } finally { await act(async () => root.unmount()); }
});
