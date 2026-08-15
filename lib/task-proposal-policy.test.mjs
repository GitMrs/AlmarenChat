import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTaskProposalSteps,
  taskProposalNeedsClarification,
  taskProposalNeedsWebResearch,
} from './task-proposal-policy.mjs';

test('task proposals cannot defer required user clarification to the worker', () => {
  assert.equal(taskProposalNeedsClarification('', ['确认用户持有的是哪类黄金']), true);
  assert.equal(taskProposalNeedsClarification('', ['等待用户补充 4430 的单位']), true);
  assert.equal(taskProposalNeedsClarification('联网核实当前黄金价格', ['查询权威来源并记录时间和单位']), false);
});

test('single-artifact proposals collapse feature phases into one execution step', () => {
  assert.deepEqual(
    normalizeTaskProposalSteps(['创建页面', '实现交互', '检查文件'], ['index.html']),
    ['完成并验收index.html：创建页面；实现交互；检查文件']
  );
  assert.deepEqual(
    normalizeTaskProposalSteps(['收集资料', '制作页面'], ['research.md', 'index.html']),
    ['收集资料', '制作页面']
  );
});

test('local resource references do not request web research', () => {
  assert.equal(taskProposalNeedsWebResearch('创建 HTML 页面', ['检查 HTML 引用资源'], ['index.html']), false);
  assert.equal(taskProposalNeedsWebResearch('联网检索官方最新利率', [], []), true);
  assert.equal(taskProposalNeedsWebResearch('整理数据并提供来源链接', [], []), true);
});
