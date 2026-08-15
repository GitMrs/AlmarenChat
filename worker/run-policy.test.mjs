import assert from 'node:assert/strict';
import test from 'node:test';
import { completionOutcome, evaluateCoordinatorAcceptance, executionFailureStatus, leaseCutoffIso, matchApprovedWorkspacePaths } from './run-policy.mjs';

test('run completion distinguishes success, partial output and validation failure', () => {
  assert.equal(completionOutcome([{ status: 'COMPLETED' }], null, []).status, 'COMPLETED');
  assert.equal(completionOutcome([{ status: 'SKIPPED' }], null, []).status, 'PARTIAL');
  assert.equal(completionOutcome([{ status: 'COMPLETED' }], { accepted: false }, []).status, 'FAILED_VALIDATION');
  assert.equal(completionOutcome([{ status: 'COMPLETED' }], { accepted: true }, [{ accepted: false }]).status, 'FAILED_VALIDATION');
});

test('execution failures distinguish missing dependencies from runtime failures', () => {
  assert.equal(executionFailureStatus(new Error('未配置可用的模型 API Key')), 'BLOCKED');
  assert.equal(executionFailureStatus(new Error('空间中没有可执行任务的 Agent')), 'BLOCKED');
  assert.equal(executionFailureStatus(new Error('找不到任务成员：frontend')), 'BLOCKED');
  assert.equal(executionFailureStatus(new Error('524 status code (no body)')), 'FAILED');
});

test('worker lease cutoff uses the configured timeout', () => {
  const now = Date.parse('2026-08-15T10:00:30.000Z');
  assert.equal(leaseCutoffIso(now, 30_000), '2026-08-15T10:00:00.000Z');
});

test('approved workspace paths match logical tool paths and stored workspace paths', () => {
  assert.deepEqual(
    matchApprovedWorkspacePaths(
      new Set(['pelican-bike.html', 'assets\\scene.css', 'not-approved.txt']),
      new Set(['workspace/pelican-bike.html', 'workspace/assets/scene.css'])
    ),
    ['pelican-bike.html', 'assets/scene.css']
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
