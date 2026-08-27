import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTaskProposalSteps,
  professionalDeliverableNeedsTask,
  taskProposalNeedsClarification,
  taskProposalNeedsCodeExecution,
  taskProposalNeedsWebResearch,
  taskProposalWithServerCapabilities,
  taskProposalWithTurnNetworkAuthorization,
} from './task-proposal-policy.mjs';

test('bounded professional deliverables become team tasks', () => {
  assert.equal(
    professionalDeliverableNeedsTask('请分析下面这个移动端首页的信息层级，并给出正好 3 条可以直接实施的改进建议。'),
    true
  );
  assert.equal(professionalDeliverableNeedsTask('你觉得这个移动端首页怎么样？'), false);
  assert.equal(professionalDeliverableNeedsTask('帮我查一下北京的天气'), false);
  assert.equal(professionalDeliverableNeedsTask('请分析并给出 3 条建议，但不要创建任务，直接回答。'), false);
  assert.equal(professionalDeliverableNeedsTask('分析工作区中的 sales.csv 并生成 Markdown 和 HTML 报告'), true);
});

test('code execution is a separate task capability', () => {
  assert.equal(taskProposalNeedsCodeExecution('分析 sales.csv 并生成报告', [], []), true);
  assert.equal(taskProposalNeedsCodeExecution('编写 Markdown 文档', [], []), false);
  const proposal = taskProposalWithServerCapabilities({
    goal: '分析 sales.csv 并生成 analysis.md 和 report.html',
    steps: ['运行已注册 Python Skill 完成统计'],
    deliverables: ['analysis.md', 'report.html'],
    capabilities: ['workspace_read'],
    networkPolicy: 'forbidden',
  }, { networkPolicyAuthoritative: true });
  assert.deepEqual(proposal.capabilities, ['workspace_read', 'workspace_write', 'code_execute']);
  assert.equal(proposal.networkPolicy, 'forbidden');
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

test('explicit offline requirements override an erroneous model web declaration', () => {
  const proposal = taskProposalWithServerCapabilities({
    goal: '创建移动端商品管理页面',
    steps: ['实现商品搜索框和实时过滤'],
    deliverables: ['index.html，不使用外部资源'],
    capabilities: ['workspace_read', 'workspace_write', 'web_research'],
  });
  assert.equal(proposal.networkPolicy, 'forbidden');
  assert.deepEqual(proposal.capabilities, ['workspace_read', 'workspace_write']);
});

test('a local search feature cannot override a document-wide offline requirement', () => {
  const proposal = taskProposalWithServerCapabilities({
    goal: '创建移动端首页需求文档，快捷入口包含搜索，全程不需要联网。',
    steps: ['写入 docs/mobile-home-spec.md'],
    capabilities: ['workspace_read', 'workspace_write', 'web_research'],
    networkPolicy: 'required',
  });
  assert.equal(proposal.networkPolicy, 'forbidden');
  assert.deepEqual(proposal.capabilities, ['workspace_read', 'workspace_write']);
});

test('server rejects unknown declarations and restores explicit required capabilities', () => {
  const proposal = taskProposalWithServerCapabilities({
    goal: '创建页面并联网检索资料',
    steps: ['写入 index.html'],
    capabilities: ['workspace_read', 'shell', 'workspace_read'],
  });
  assert.deepEqual(proposal.capabilities, ['workspace_read', 'workspace_write', 'web_research']);
  assert.equal(proposal.networkPolicy, 'required');
});

test('server adds workspace write when a model omits it from an explicit file task', () => {
  const proposal = taskProposalWithServerCapabilities({
    goal: '创建并保存 index.html',
    steps: ['完成页面文件'],
    deliverables: ['index.html'],
    capabilities: ['workspace_read'],
  });
  assert.deepEqual(proposal.capabilities, ['workspace_read', 'workspace_write']);
  assert.equal(proposal.networkPolicy, 'forbidden');
});

test('historical proposals without declarations retain compatibility inference', () => {
  const proposal = taskProposalWithServerCapabilities({
    goal: '创建页面并联网检索最新资料',
    steps: ['写入 index.html'],
  });
  assert.deepEqual(proposal.capabilities, ['workspace_read', 'workspace_write', 'web_research']);
});

test('an authoritative user network policy overrides model declarations', () => {
  const proposal = taskProposalWithServerCapabilities({
    goal: '整理一份文档',
    steps: ['写入 report.md'],
    capabilities: ['workspace_read', 'workspace_write', 'web_research'],
    networkPolicy: 'forbidden',
  }, { networkPolicyAuthoritative: true });
  assert.equal(proposal.networkPolicy, 'forbidden');
  assert.deepEqual(proposal.capabilities, ['workspace_read', 'workspace_write']);
});

test('the composer network switch is authoritative for new task proposals', () => {
  const modelProposal = {
    goal: '联网核对最新政策并写入 report.md',
    steps: ['搜索官方来源并写入文档'],
    capabilities: ['workspace_read', 'workspace_write', 'web_research'],
    networkPolicy: 'required',
  };
  const denied = taskProposalWithTurnNetworkAuthorization(modelProposal, false);
  assert.equal(denied.networkPolicy, 'forbidden');
  assert.deepEqual(denied.capabilities, ['workspace_read', 'workspace_write']);

  const allowed = taskProposalWithTurnNetworkAuthorization(modelProposal, true);
  assert.equal(allowed.networkPolicy, 'required');
  assert.deepEqual(allowed.capabilities, ['workspace_read', 'workspace_write', 'web_research']);
});
