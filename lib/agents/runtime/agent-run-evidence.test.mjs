import assert from 'node:assert/strict';
import test from 'node:test';
import { recentRunEvidenceContext, summarizeRunEvidence } from './agent-run-evidence.mjs';

test('failed runs report actual reads without claiming file changes or validation', () => {
  const run = {
    id: 'run-failed',
    status: 'FAILED',
    input: '更新 index.html',
    error: 'Agent 工具调用超过 10 轮，任务已停止',
    artifactManifests: [{ status: 'INCOMPLETE', entries: [], validation: { checks: [] } }],
    taskCompletions: [],
    events: Array.from({ length: 7 }, () => ({ type: 'TOOL_COMPLETED', payload: { tool: 'read_file' } })),
  };
  const summary = summarizeRunEvidence(run);
  assert.equal(summary.fileChangeCount, 0);
  assert.equal(summary.validationCheckCount, 0);
  assert.deepEqual(summary.tools, ['read_file×7']);
  const context = recentRunEvidenceContext([run]);
  assert.match(context, /文件变更：0（无）/);
  assert.match(context, /自动校验：0 项/);
  assert.match(context, /read_file×7/);
  assert.match(context, /不得声称已写入/);
});

test('completed runs expose only manifest-backed files and checks', () => {
  const summary = summarizeRunEvidence({
    id: 'run-complete',
    status: 'COMPLETED',
    input: '创建页面',
    result: '页面已完成',
    artifactManifests: [{
      status: 'APPLIED',
      entries: [{ path: 'index.html', change: 'CREATED' }],
      validation: { checks: [{ check: 'html', ok: true }] },
    }],
    taskCompletions: [{ status: 'ACCEPTED' }],
    events: [{ type: 'TOOL_COMPLETED', payload: { tool: 'write_file' } }],
  });
  assert.equal(summary.fileChangeCount, 1);
  assert.deepEqual(summary.changedPaths, ['index.html']);
  assert.equal(summary.validationCheckCount, 1);
  assert.equal(summary.acceptedTaskCount, 1);
});
