import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultModelRequestLimit, normalizeExecutionPlan } from './task-execution-plan.mjs';

const members = [
  { id: 'product', name: '产品' },
  { id: 'frontend', name: '前端' },
];

test('keeps a validated advisor to executor chain', () => {
  const tasks = normalizeExecutionPlan({
    capabilities: ['workspace_write'],
    executionPlan: [
      { agentId: 'product', mode: 'advisor', title: '梳理规则', instruction: '输出规则', dependsOn: [], deliverables: ['规则'] },
      { agentId: 'frontend', mode: 'executor', title: '实现页面', instruction: '写入页面', dependsOn: [0], deliverables: ['index.html'] },
    ],
  }, members);
  assert.deepEqual(tasks.map(({ agentId, mode, dependsOn }) => ({ agentId, mode, dependsOn })), [
    { agentId: 'product', mode: 'advisor', dependsOn: [] },
    { agentId: 'frontend', mode: 'executor', dependsOn: [0] },
  ]);
  assert.equal(defaultModelRequestLimit(tasks), 20);
});

test('rejects agents outside the space', () => {
  assert.throws(() => normalizeExecutionPlan({
    executionPlan: [{ agentId: 'unknown', mode: 'executor', title: '执行', instruction: '执行', dependsOn: [] }],
  }, members), /不在空间/);
});

test('allows the coordinator only as an advisor', () => {
  const available = [
    { id: 'space-coordinator', name: '空间协调者', advisorOnly: true, fallbackResearchAdvisor: true },
    ...members,
  ];
  const withoutProduct = available.filter((member) => member.id !== 'product');
  const tasks = normalizeExecutionPlan({
    capabilities: ['workspace_write', 'web_research'],
    executionPlan: [
      { agentId: 'space-coordinator', mode: 'advisor', title: '调研概念', instruction: '联网核实概念并给出实现边界', dependsOn: [], deliverables: ['调研结论'] },
      { agentId: 'frontend', mode: 'executor', title: '实现页面', instruction: '依据批准的调研结论实现页面', dependsOn: [0], deliverables: ['index.html'] },
    ],
  }, withoutProduct, 'frontend');
  assert.equal(tasks[0].agentId, 'space-coordinator');
  assert.equal(tasks[0].mode, 'advisor');

  assert.throws(() => normalizeExecutionPlan({
    executionPlan: [
      { agentId: 'space-coordinator', mode: 'executor', title: '实现', instruction: '写文件', dependsOn: [], deliverables: [] },
    ],
  }, available, 'frontend'), /只能将该角色用作顾问/);
  assert.throws(() => normalizeExecutionPlan({
    executionPlan: [
      { agentId: 'space-coordinator', mode: 'advisor', title: '调研', instruction: '联网调研', dependsOn: [], deliverables: ['结论'] },
    ],
  }, available, 'frontend'), /优先使用空间中的产品成员/);
});

test('rejects forward dependencies and allows authorized advisor file work', () => {
  assert.throws(() => normalizeExecutionPlan({
    executionPlan: [{ agentId: 'product', mode: 'advisor', title: '规则', instruction: '规则', dependsOn: [0] }],
  }, members), /无效依赖/);
  const tasks = normalizeExecutionPlan({
    capabilities: ['workspace_write'],
    executionPlan: [{ agentId: 'product', mode: 'advisor', title: '规则', instruction: '创建 docs/spec.md', dependsOn: [] }],
  }, members);
  assert.equal(tasks[0].mode, 'advisor');
});

test('converts legacy proposal steps to executor tasks', () => {
  const tasks = normalizeExecutionPlan({ steps: ['完成文件'], deliverables: ['index.html'] }, members, 'frontend');
  assert.equal(tasks[0].agentId, 'frontend');
  assert.equal(tasks[0].mode, 'executor');
  assert.deepEqual(tasks[0].deliverables, ['index.html']);
});

test('assigns bounded run budgets by execution-chain complexity', () => {
  assert.equal(defaultModelRequestLimit([{ mode: 'executor' }]), 12);
  assert.equal(defaultModelRequestLimit([{ mode: 'executor' }, { mode: 'executor' }]), 24);
  assert.equal(defaultModelRequestLimit(Array.from({ length: 5 }, () => ({ mode: 'executor' }))), 48);
});
