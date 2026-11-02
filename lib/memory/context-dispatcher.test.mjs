import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchContextCandidates, planContextSources } from './context-dispatcher.mjs';

test('small talk does not request optional context sources', () => {
  assert.deepEqual(planContextSources('你好'), {
    memory: false, experience: false, knowledge: false, platform: false, activity: false, world: false,
  });
});

test('knowledge is queried only for a substantive knowledge-shaped message', () => {
  assert.equal(planContextSources('我今天有点累').knowledge, false);
  assert.equal(planContextSources('这个 TypeScript 报错怎么解决？').knowledge, true);
});

test('context candidates are nonempty and ordered by source value', () => {
  const selected = dispatchContextCandidates('午饭吃什么', [
    { name: '世界事件', content: '市场事件' },
    { name: '角色知识库', content: '饮食文档' },
    { name: '相关长期记忆', content: '用户午饭偏好清淡' },
    { name: '空资料', content: '' },
  ]);
  assert.deepEqual(selected.map(item => item.name), ['相关长期记忆', '角色知识库', '世界事件']);
});
