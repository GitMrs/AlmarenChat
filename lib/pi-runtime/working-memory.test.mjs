import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPiWorkingContext,
  collapseCompletedPiScopes,
  piScopeMarker,
  selectRelevantProjectMemory,
} from './working-memory.mjs';

const user = (content) => ({ role: 'user', content });
const assistant = (content) => ({ role: 'assistant', content: [{ type: 'text', text: content }] });

test('scoped Pi collaboration excludes unrelated history and coordinator setup', () => {
  const marker = piScopeMarker('scope-1');
  const messages = [
    user('请大家介绍自己'),
    assistant('我是产品。'),
    user('请进行一轮成语接龙'),
    { role: 'assistant', content: [{ type: 'toolCall', id: 'coordinate-1', name: 'coordinate_members', arguments: {} }] },
    { role: 'toolResult', toolCallId: 'coordinate-1', toolName: 'coordinate_members', content: [] },
    assistant('我来组织接龙。'),
    user(`${marker}\n轮到产品接龙`),
    assistant('一心一意'),
    user(`${marker}\n轮到前端接龙`),
  ];

  const scoped = buildPiWorkingContext(messages, { scopeId: 'scope-1', scopeTopic: '进行一轮成语接龙' });

  assert.deepEqual(scoped, [messages[2], messages[6], messages[7], messages[8]]);
  assert.equal(scoped.some((message) => JSON.stringify(message).includes('我是产品')), false);
  assert.equal(scoped.some((message) => message.role === 'toolResult'), false);
});

test('scoped Pi collaboration retrieves related history only when explicitly referenced', () => {
  const marker = piScopeMarker('scope-2');
  const messages = [
    user('请大家介绍自己'),
    assistant('我是产品，关注需求边界。'),
    user('今天的天气不错'),
    assistant('确实不错。'),
    user('根据刚才的介绍讨论方案'),
    assistant('我来组织讨论。'),
    user(`${marker}\n轮到产品发言`),
  ];

  const scoped = buildPiWorkingContext(messages, {
    scopeId: 'scope-2',
    scopeTopic: '根据刚才的介绍讨论方案',
  });

  assert.equal(scoped.some((message) => JSON.stringify(message).includes('需求边界')), true);
  assert.equal(scoped.some((message) => JSON.stringify(message).includes('天气不错')), false);
  assert.equal(scoped.at(-1), messages.at(-1));
});

test('ordinary Pi chat keeps the original session context', () => {
  const messages = [user('第一条'), assistant('第一条回复'), user('继续')];
  assert.equal(buildPiWorkingContext(messages), messages);
});

test('completed collaboration becomes its final summary in later chat context', () => {
  const marker = piScopeMarker('scope-3');
  const messages = [
    user('请四位成员进行成语接龙'),
    { role: 'assistant', content: [{ type: 'toolCall', id: 'coordinate-3', name: 'coordinate_members', arguments: {} }] },
    { role: 'toolResult', toolCallId: 'coordinate-3', toolName: 'coordinate_members', content: [] },
    assistant('开始接龙。'),
    user(`${marker}\n[Almaren 内部协作阶段：coordinated_turn]\n轮到产品`),
    assistant('一心一意'),
    user(`${marker}\n[Almaren 内部协作阶段：coordination_summary]\n请总结`),
    assistant('四位成员已经完成一轮成语接龙。'),
    user('我们换个话题'),
  ];

  const collapsed = collapseCompletedPiScopes(messages);

  assert.deepEqual(collapsed, [messages[0], messages[7], messages[8]]);
  assert.equal(collapsed.some((message) => JSON.stringify(message).includes('一心一意')), false);
});

test('active or interrupted collaboration is not collapsed', () => {
  const marker = piScopeMarker('scope-4');
  const messages = [user('开始讨论'), user(`${marker}\n成员发言`), assistant('成员观点')];
  assert.equal(collapseCompletedPiScopes(messages, { activeScopeId: 'scope-4' }), messages);
  assert.equal(collapseCompletedPiScopes(messages), messages);
});

test('project memory retrieval keeps matching lines instead of the entire memory', () => {
  const memory = `当前空间的持久项目记忆如下。\n\n历史摘要：\n房贷页面使用单文件 HTML。\n小说项目已完成第一章。\n\n最近活动：\n用户要求继续优化房贷计算器。`;
  const selected = selectRelevantProjectMemory(memory, '继续房贷计算器');

  assert.match(selected, /单文件 HTML/);
  assert.match(selected, /继续优化房贷计算器/);
  assert.doesNotMatch(selected, /小说项目/);
  assert.equal(selectRelevantProjectMemory(memory, '讨论房贷计算器'), '');
});
