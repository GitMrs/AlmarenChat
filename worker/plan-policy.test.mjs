import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeOverlappingPlanTasks } from './plan-policy.mjs';

test('merges adjacent work assigned to the same agent and deliverable', () => {
  const plan = mergeOverlappingPlanTasks([
    { agentId: 'frontend', title: '创建页面', instruction: '创建完整页面', deliverables: ['workspace/index.html'] },
    { agentId: 'frontend', title: '补充交互', instruction: '实现页面交互', deliverables: ['index.html'] },
    { agentId: 'frontend', title: '检查页面', instruction: '检查并交付页面', deliverables: ['index.html'] },
  ]);

  assert.equal(plan.length, 1);
  assert.match(plan[0].instruction, /创建完整页面/);
  assert.match(plan[0].instruction, /实现页面交互/);
  assert.match(plan[0].instruction, /检查并交付页面/);
});

test('keeps independent deliverables and different agents separate', () => {
  const plan = mergeOverlappingPlanTasks([
    { agentId: 'research', title: '调研', instruction: '收集资料', deliverables: ['research.md'] },
    { agentId: 'frontend', title: '页面', instruction: '制作页面', deliverables: ['index.html'] },
    { agentId: 'frontend', title: '说明', instruction: '编写说明', deliverables: ['README.md'] },
  ]);

  assert.equal(plan.length, 3);
});
