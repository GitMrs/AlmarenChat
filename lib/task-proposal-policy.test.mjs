import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTaskProposalSteps,
  professionalDeliverableNeedsTask,
  taskProposalNeedsClarification,
  taskProposalNeedsWebResearch,
  taskProposalWithServerCapabilities,
} from './task-proposal-policy.mjs';

test('bounded professional deliverables become team tasks', () => {
  assert.equal(
    professionalDeliverableNeedsTask('请分析下面这个移动端首页的信息层级，并给出正好 3 条可以直接实施的改进建议。'),
    true
  );
  assert.equal(professionalDeliverableNeedsTask('你觉得这个移动端首页怎么样？'), false);
  assert.equal(professionalDeliverableNeedsTask('请分析并给出 3 条建议，但不要创建任务，直接回答。'), false);
});

test('task proposals cannot defer required user clarification to the worker', () => {
  assert.equal(taskProposalNeedsClarification('', ['确认用户持有的是哪类黄金']), true);
  assert.equal(taskProposalNeedsClarification('', ['等待用户补充 4430 的单位']), true);
  assert.equal(taskProposalNeedsClarification('联网核实当前黄金价格', ['查询权威来源并记录时间和单位']), false);
  assert.equal(taskProposalNeedsClarification('信息已经完整，不需要用户补充', []), false);
  assert.equal(taskProposalNeedsClarification('使用用户提供的数据', ['不再询问用户，直接制作']), false);
  assert.equal(taskProposalNeedsClarification('使用现有数据', ['用户补充利率后继续']), true);
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
  assert.equal(taskProposalNeedsWebResearch('创建无需联网资源的 HTML 页面', [], ['index.html']), false);
  assert.equal(taskProposalNeedsWebResearch('使用已有天气数据制作页面，不重新联网', [], ['页面保留已有来源链接']), false);
  assert.equal(taskProposalNeedsWebResearch('联网检索官方最新利率', [], []), true);
  assert.equal(taskProposalNeedsWebResearch('整理数据并提供来源链接', [], []), true);
});

test('server preserves valid structured capability declarations', () => {
  const proposal = taskProposalWithServerCapabilities({
    goal: '创建移动端商品管理页面',
    steps: ['实现商品搜索框和实时过滤'],
    deliverables: ['index.html，不使用外部资源'],
    capabilities: ['workspace_read', 'workspace_write', 'web_research'],
  });
  assert.deepEqual(proposal.capabilities, ['workspace_read', 'workspace_write', 'web_research']);
});

test('server rejects unknown declared capabilities without inferring replacements', () => {
  const proposal = taskProposalWithServerCapabilities({
    goal: '创建页面并联网检索资料',
    steps: ['写入 index.html'],
    capabilities: ['workspace_read', 'shell', 'workspace_read'],
  });
  assert.deepEqual(proposal.capabilities, ['workspace_read']);
});

test('historical proposals without declarations retain compatibility inference', () => {
  const proposal = taskProposalWithServerCapabilities({
    goal: '创建页面并联网检索最新资料',
    steps: ['写入 index.html'],
  });
  assert.deepEqual(proposal.capabilities, ['workspace_read', 'workspace_write', 'web_research']);
});
