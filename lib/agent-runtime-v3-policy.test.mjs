import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinatorAuthorization, dispatchRequiresApproval, normalizeCoordinatorAction } from './agent-runtime-v3-policy.mjs';

const members = [
  { id: 'product', name: '产品' },
  { id: 'frontend', name: '前端' },
];

test('normalizes a dynamic dispatch against the current roster', () => {
  const action = normalizeCoordinatorAction({
    type: 'dispatch',
    summary: '先实现页面',
    tasks: [{
      agentId: 'frontend', mode: 'executor', title: '实现儿童时钟',
      instruction: '创建并检查儿童时钟页面。', acceptanceCriteria: '页面可交互且文件检查通过。',
      reason: '需求明确，主要工作是页面和浏览器交互。', expectedArtifacts: ['index.html'],
    }],
  }, { members, remainingTasks: 8 });
  assert.equal(action.tasks[0].agentName, '前端');
  assert.equal(action.tasks[0].reason, '需求明确，主要工作是页面和浏览器交互。');
});

test('rejects unknown members and duplicate tasks', () => {
  assert.throws(() => normalizeCoordinatorAction({
    type: 'dispatch', tasks: [{ agentId: 'missing', title: 'x', instruction: 'x', acceptanceCriteria: 'x', reason: 'x' }],
  }, { members, remainingTasks: 8 }), /不在空间/);
  assert.throws(() => normalizeCoordinatorAction({
    type: 'dispatch', tasks: [{ agentId: 'frontend', title: '实现', instruction: '创建页面', acceptanceCriteria: '完成', reason: '适合' }],
  }, { members, remainingTasks: 8, existingTasks: [{ agentId: 'frontend', title: '实现', instruction: '创建页面' }] }), /重复/);
});

test('finish requires at least one accepted result', () => {
  assert.throws(() => normalizeCoordinatorAction({ type: 'finish', summary: '完成' }, { allowFinish: false }), /不能结束/);
  assert.equal(normalizeCoordinatorAction({ type: 'finish', summary: '完成' }, { allowFinish: true }).type, 'finish');
});

test('authorization contains goals and limits but no fixed execution plan', () => {
  const authorization = coordinatorAuthorization({ goal: '做页面', steps: ['实现并验收'], deliverables: ['网页'], capabilities: ['workspace_write'] });
  assert.equal(authorization.objective, '做页面');
  assert.equal(authorization.maxTasks, 8);
  assert.equal('authorizedPlan' in authorization, false);
});

test('dispatch approval is the safe default while auto mode remains available', () => {
  assert.equal(dispatchRequiresApproval('REVIEW_DISPATCH'), true);
  assert.equal(dispatchRequiresApproval(undefined), true);
  assert.equal(dispatchRequiresApproval('AUTO'), false);
});
