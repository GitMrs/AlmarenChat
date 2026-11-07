import assert from 'node:assert/strict';
import test from 'node:test';
import { createCapabilityHelpTool, describeCapabilities } from './help.mjs';

test('capability help reports defaults without exposing tool implementation names', () => {
  const result = describeCapabilities({ entry: 'assistant' });
  const memory = result.capabilities.find((item) => item.id === 'assistant_memory');
  const weather = result.capabilities.find((item) => item.id === 'weather');
  assert.equal(memory.status, '默认可用');
  assert.equal(weather.status, '可按需使用');
  assert.equal(result.capabilities.some((item) => 'tools' in item), false);
});

test('capability help distinguishes enabled account capabilities', () => {
  const result = describeCapabilities({ entry: 'agent', enabledCapabilities: ['bilibili'] });
  assert.equal(result.capabilities.find((item) => item.id === 'bilibili').status, '已启用');
});

test('capability help marks disabled capabilities unavailable', () => {
  const result = describeCapabilities({ entry: 'space', disabledCapabilities: ['weather'] });
  assert.equal(result.capabilities.find((item) => item.id === 'weather').status, '当前不可用');
});

test('capability help respects actual executor availability', () => {
  const result = describeCapabilities({ entry: 'task', phase: 'task', availableToolNames: ['read_file'] });
  assert.equal(result.capabilities.find((item) => item.id === 'space_read').status, '默认可用');
  assert.equal(result.capabilities.find((item) => item.id === 'web').status, '当前不可用');
  assert.equal(result.loaded.includes('space_tasks'), false);
  assert.match(result.capabilities.find((item) => item.id === 'web').hint, /本轮未提供/);
});

test('capability help tool is read-only and fixed to its entry scope', async () => {
  const help = createCapabilityHelpTool({ entry: 'agent' });
  assert.equal(help.tool.function.name, 'capability_help');
  assert.equal('entry' in help.tool.function.parameters.properties, false);
  const result = await help.execute({ entry: 'assistant' });
  assert.equal(result.entry, 'agent');
});

test('actual loaded account tools are not described as requiring activation', () => {
  const result = describeCapabilities({ entry: 'space', availableToolNames: ['bilibili_search'] });
  assert.equal(result.capabilities.find((item) => item.id === 'bilibili').status, '本轮已加载');
  assert.deepEqual(result.loaded, ['bilibili']);
});

test('help reads live tools after dynamic loading', async () => {
  const names = [];
  const help = createCapabilityHelpTool({ entry: 'agent', getAvailableToolNames: () => names });
  assert.equal((await help.execute()).loaded.includes('weather'), false);
  names.push('weather_query');
  const result = await help.execute();
  assert.equal(result.loaded.includes('weather'), true);
  assert.equal(result.capabilities.find((item) => item.id === 'weather').status, '本轮已加载');
});

test('help distinguishes loadable capabilities from missing executors without granting permission', () => {
  const options = { entry: 'agent', availableToolNames: ['capability_load'], loadableCapabilities: ['weather'] };
  const result = describeCapabilities(options);
  assert.equal(result.capabilities.find((item) => item.id === 'weather').status, '可按需使用');
  assert.equal(result.loaded.includes('weather'), false);
  assert.equal(result.capabilities.find((item) => item.id === 'crypto').status, '当前不可用');
  for (const restrictions of [{ disabledCapabilities: ['weather'] }, { permittedCapabilities: [] }]) {
    const denied = describeCapabilities({ ...options, ...restrictions });
    assert.equal(denied.capabilities.find((item) => item.id === 'weather').status, '当前不可用');
  }
});
