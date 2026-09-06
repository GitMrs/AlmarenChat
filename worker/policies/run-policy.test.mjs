import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completionOutcome,
  directRunSummary,
  evaluateCoordinatorAcceptance,
  executionFailureStatus,
  leaseCutoffIso,
  matchApprovedWorkspacePaths,
  shouldPauseRunProcessing,
} from './run-policy.mjs';

test('run completion distinguishes success, partial output and validation failure', () => {
  assert.equal(completionOutcome([{ status: 'COMPLETED' }], null, []).status, 'COMPLETED');
  assert.equal(completionOutcome([{ status: 'SKIPPED' }], null, []).status, 'PARTIAL');
  assert.equal(completionOutcome([{ status: 'COMPLETED' }], { accepted: false }, []).status, 'FAILED_VALIDATION');
  assert.equal(completionOutcome([{ status: 'COMPLETED' }], { accepted: true }, [{ accepted: false }]).status, 'FAILED_VALIDATION');
});

test('single executor and advisor-to-executor chains reuse the final task result', () => {
  assert.equal(directRunSummary([
    { status: 'COMPLETED', mode: 'executor', result: '已完成页面' },
  ], { accepted: true }), '已完成页面');
  assert.equal(directRunSummary([
    { status: 'COMPLETED', mode: 'advisor', result: '产品规则' },
    { status: 'COMPLETED', mode: 'executor', result: '已实现规则' },
  ], { accepted: true }), '已实现规则');
  assert.equal(directRunSummary([
    { status: 'COMPLETED', mode: 'executor', result: '前端结果' },
    { status: 'COMPLETED', mode: 'executor', result: '后端结果' },
  ], { accepted: true }), null);
  assert.match(directRunSummary([
    { status: 'COMPLETED', mode: 'executor', result: '已完成页面' },
  ], { accepted: false, issues: ['缺少文件'] }), /验收未通过：缺少文件/);
});

test('execution failures distinguish missing dependencies from runtime failures', () => {
  assert.equal(executionFailureStatus(new Error('未配置可用的模型 API Key')), 'BLOCKED');
  assert.equal(executionFailureStatus(new Error('空间中没有可执行任务的 Agent')), 'BLOCKED');
  assert.equal(executionFailureStatus(new Error('找不到任务成员：frontend')), 'BLOCKED');
  assert.equal(executionFailureStatus(new Error('524 status code (no body)')), 'FAILED');
  const budgetError = new Error('预算用尽');
  budgetError.code = 'MODEL_REQUEST_BUDGET';
  assert.equal(executionFailureStatus(budgetError), 'BLOCKED');
  const taskBlockedError = new Error('联网资料未通过验收');
  taskBlockedError.code = 'TASK_BLOCKED';
  assert.equal(executionFailureStatus(taskBlockedError), 'BLOCKED');
  const providerError = new Error('500 empty_stream: upstream stream closed before first payload');
  providerError.code = 'MODEL_PROVIDER_TRANSIENT';
  assert.equal(executionFailureStatus(providerError), 'BLOCKED');
});

test('worker lease cutoff uses the configured timeout', () => {
  const now = Date.parse('2026-08-15T10:00:30.000Z');
  assert.equal(leaseCutoffIso(now, 30_000), '2026-08-15T10:00:00.000Z');
});

test('worker pauses when accepted work produces a proposal awaiting dispatch approval', () => {
  assert.equal(shouldPauseRunProcessing('WAITING_APPROVAL'), true);
  assert.equal(shouldPauseRunProcessing('QUEUED'), true);
  assert.equal(shouldPauseRunProcessing('WAITING'), true);
  assert.equal(shouldPauseRunProcessing('BLOCKED'), true);
  assert.equal(shouldPauseRunProcessing('RUNNING'), false);
});

test('approved workspace paths match logical tool paths and stored workspace paths', () => {
  assert.deepEqual(
    matchApprovedWorkspacePaths(
      new Set(['pelican-bike.html', 'assets\\scene.css', 'not-approved.txt']),
      new Set(['workspace/pelican-bike.html', 'workspace/assets/scene.css'])
    ),
    ['pelican-bike.html', 'assets/scene.css']
  );
  assert.deepEqual(
    matchApprovedWorkspacePaths(
      new Set(['article.md', 'publish-info.md']),
      new Set([
        'workspace/works/work-1/article.md',
        'workspace/works/work-1/publish-info.md',
      ]),
      'work-1'
    ),
    ['article.md', 'publish-info.md']
  );
});

test('coordinator acceptance requires applied validated manifests and requested workspace output', () => {
  const task = { id: 'task-1', attempt: 1, status: 'COMPLETED', title: '创建页面', agentName: '前端', result: '完成' };
  const accepted = evaluateCoordinatorAcceptance({
    goal: '创建网页',
    tasks: [task],
    manifests: [{
      taskId: 'task-1',
      attempt: 1,
      status: 'APPLIED',
      entries: JSON.stringify([{ path: 'index.html', change: 'CREATED' }]),
      validation: JSON.stringify({ valid: true, files: [{ path: 'index.html', valid: true }], checks: [] }),
    }],
    events: [{ type: 'TOOL_COMPLETED' }],
    expectsWorkspaceWrite: true,
  });
  assert.equal(accepted.status, 'COMPLETED');
  assert.equal(accepted.evidence.workspaceChanges, 1);

  const rejected = evaluateCoordinatorAcceptance({
    goal: '创建网页',
    tasks: [task],
    manifests: [],
    events: [],
    expectsWorkspaceWrite: true,
  });
  assert.equal(rejected.status, 'FAILED_VALIDATION');
  assert.match(rejected.issues.join('\n'), /ArtifactManifest/);
});

test('coordinator acceptance does not require a workspace manifest for advisor tasks', () => {
  const accepted = evaluateCoordinatorAcceptance({
    goal: '梳理规则',
    tasks: [{ id: 'advisor-1', attempt: 1, mode: 'advisor', status: 'COMPLETED', title: '梳理规则', agentName: '产品', result: '规则' }],
    manifests: [],
    events: [],
  });
  assert.equal(accepted.status, 'COMPLETED');
});

test('coordinator acceptance validates workspace manifests produced by advisor tasks', () => {
  const accepted = evaluateCoordinatorAcceptance({
    goal: '创建产品规则文档',
    tasks: [{ id: 'advisor-1', attempt: 1, mode: 'advisor', status: 'COMPLETED', title: '梳理规则', agentName: '产品', result: '规则已整理' }],
    manifests: [{
      taskId: 'advisor-1',
      attempt: 1,
      status: 'APPLIED',
      entries: JSON.stringify([{ path: 'docs/spec.md', change: 'CREATED' }]),
      validation: JSON.stringify({ valid: true, files: [{ path: 'docs/spec.md', valid: true }], checks: [] }),
    }],
    events: [],
    expectsWorkspaceWrite: true,
  });
  assert.equal(accepted.status, 'COMPLETED');
  assert.equal(accepted.evidence.workspaceChanges, 1);
});

test('coordinator acceptance fails when final coverage omits an authorized deliverable', () => {
  const acceptance = evaluateCoordinatorAcceptance({
    goal: '实现并交付页面',
    tasks: [{ id: 'task-1', agentName: '前端', title: '实现页面', status: 'COMPLETED', mode: 'advisor', attempt: 1, result: '完成' }],
    manifests: [],
    events: [],
    authorization: { steps: ['实现页面'], deliverables: ['交付 index.html'] },
    goalCoverage: [{ requirement: '实现页面', taskIds: ['task-1'], evidence: '页面已完成' }],
  });
  assert.equal(acceptance.accepted, false);
  assert.match(acceptance.issues.join('\n'), /交付 index\.html/);
  assert.equal(acceptance.evidence.coveredRequirements, 1);
  assert.equal(acceptance.evidence.requirementCount, 2);
});

test('a rejected proposal does not make a successfully replanned run partial', () => {
  const acceptance = evaluateCoordinatorAcceptance({
    goal: '完成页面',
    tasks: [
      { id: 'rejected', status: 'CANCELLED', approvedAt: null, startedAt: null, title: '错误派发' },
      { id: 'completed', status: 'COMPLETED', mode: 'advisor', result: '完成', title: '正确任务' },
    ],
    manifests: [],
    events: [],
  });
  assert.equal(acceptance.status, 'COMPLETED');
  assert.deepEqual(acceptance.warnings, []);
});
