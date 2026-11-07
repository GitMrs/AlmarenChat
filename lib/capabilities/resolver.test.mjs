import test from 'node:test';
import assert from 'node:assert/strict';
import { filterToolSchemas, resolveCapabilities } from './resolver.mjs';

test('ordinary assistant and agent chat keep only role capabilities', () => {
  const assistant = resolveCapabilities({ entry: 'assistant', query: '你好' });
  const agent = resolveCapabilities({ entry: 'agent', query: '我们聊聊' });
  assert.deepEqual(assistant.capabilities, ['assistant_memory']);
  assert.deepEqual(agent.capabilities, ['agent_memory', 'agent_growth']);
  assert.equal(assistant.tools.includes('weather_query'), false);
  assert.equal(agent.tools.includes('web_search'), false);
});

test('external read capabilities activate only for a matching request', () => {
  const weather = resolveCapabilities({ entry: 'assistant', query: '查一下今天北京天气' });
  const crypto = resolveCapabilities({ entry: 'assistant', query: '看看比特币行情' });
  assert.deepEqual(weather.capabilities, ['assistant_memory', 'weather']);
  assert.deepEqual(crypto.capabilities, ['assistant_memory', 'crypto']);
  assert.equal(crypto.tools.includes('weather_query'), false);
  assert.equal(crypto.tools.includes('crypto_quote'), true);
});

test('space phases keep space defaults but delay workspace and task tools', () => {
  const chat = resolveCapabilities({ entry: 'space', query: '这个想法怎么样', phase: 'chat' });
  const artifact = resolveCapabilities({ entry: 'space', query: '把方案写成网页', phase: 'artifact' });
  const task = resolveCapabilities({ entry: 'task', query: '开始执行', phase: 'task' });
  assert.equal(chat.capabilities.includes('space_runtime'), true);
  assert.equal(chat.capabilities.includes('space_workspace'), false);
  assert.equal(chat.tools.includes('read_file'), true);
  assert.equal(chat.tools.includes('write_file'), false);
  assert.equal(chat.capabilities.includes('space_tasks'), false);
  assert.equal(artifact.capabilities.includes('space_workspace'), true);
  assert.equal(task.capabilities.includes('space_tasks'), true);
});

test('account external capabilities require explicit enabling', () => {
  const unavailable = resolveCapabilities({ entry: 'agent', query: '帮我看看 Bilibili 最近的视频' });
  const enabled = resolveCapabilities({ entry: 'agent', query: '帮我看看 Bilibili 最近的视频', enabledCapabilities: ['bilibili'] });
  assert.equal(unavailable.tools.includes('bilibili_search'), false);
  assert.deepEqual(unavailable.unavailable, [{ id: 'bilibili', label: 'Bilibili', reason: '需要先启用此能力' }]);
  assert.equal(enabled.tools.includes('bilibili_search'), true);
});

test('tool schemas are filtered after capability resolution', () => {
  const resolution = resolveCapabilities({ entry: 'assistant', query: '天气' });
  const schemas = ['memory_search', 'weather_query', 'trending_query'].map(name => ({ type: 'function', function: { name } }));
  assert.deepEqual(filterToolSchemas(schemas, resolution).map(item => item.function.name), ['memory_search', 'weather_query']);
});

test('explicit permission limits cannot be bypassed by enabling or requesting a capability', () => {
  const denied = resolveCapabilities({
    entry: 'agent', query: '查天气和 Bilibili', permittedCapabilities: [],
    enabledCapabilities: ['bilibili'], requestedCapabilities: ['weather', 'bilibili'],
  });
  assert.equal(denied.tools.includes('weather_query'), false);
  assert.equal(denied.tools.includes('bilibili_search'), false);
});

test('enabled capability remains on demand while pending queries can request continuation', () => {
  const idle = resolveCapabilities({ entry: 'agent', query: '你好', enabledCapabilities: ['bilibili', 'weather'] });
  assert.equal(idle.tools.includes('bilibili_search'), false);
  assert.equal(idle.tools.includes('weather_query'), false);
  const continuation = resolveCapabilities({ entry: 'assistant', query: '北京', requestedCapabilities: ['weather'] });
  assert.equal(continuation.tools.includes('weather_query'), true);
});

test('requesting account capability is not authorization', () => {
  const result = resolveCapabilities({ entry: 'agent', requestedCapabilities: ['bilibili'] });
  assert.equal(result.tools.includes('bilibili_search'), false);
});
