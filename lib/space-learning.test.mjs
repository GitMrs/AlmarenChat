import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import {
  emptySpaceLearning,
  extractSpaceLearningCandidates,
  mergeSpaceLearningCandidates,
  readSpaceLearning,
  spaceLearningContext,
  spaceLearningPaths,
  updateSpaceLearning,
  writeSpaceLearning,
} from './space-learning.mjs';

function failedRun(id = 'run-1') {
  return {
    id,
    status: 'FAILED_VALIDATION',
    result: '已经修改文件并通过检查。',
    updatedAt: '2026-08-29T00:00:00.000Z',
    tasks: [{ title: '实现页面', reviewFeedback: null }],
    events: [
      { type: 'TASK_REVISION_REQUESTED', payload: { feedback: '保留现有布局，不要整页重写。' } },
      { type: 'RUN_ACCEPTANCE_COMPLETED', payload: { accepted: false, issues: ['首屏没有完整显示两条任务'] } },
    ],
    artifactManifests: [],
    taskCompletions: [],
  };
}

test('space learning extracts only evidence-backed correction candidates and deduplicates runs', () => {
  const candidates = extractSpaceLearningCandidates([failedRun()]);
  assert.equal(candidates.length, 4);
  const first = mergeSpaceLearningCandidates(emptySpaceLearning(), candidates);
  assert.equal(first.changed, true);
  assert.equal(first.state.proposals.length, 4);
  const duplicate = mergeSpaceLearningCandidates(first.state, candidates);
  assert.equal(duplicate.changed, false);
  const recurring = mergeSpaceLearningCandidates(first.state, extractSpaceLearningCandidates([failedRun('run-2')]));
  assert.equal(recurring.state.proposals.every((proposal) => proposal.occurrences === 2), true);
});

test('approving a proposal creates a bounded active context and version history', () => {
  const merged = mergeSpaceLearningCandidates(emptySpaceLearning(), extractSpaceLearningCandidates([failedRun()])).state;
  const proposal = merged.proposals[0];
  const approved = updateSpaceLearning(merged, {
    action: 'approve', id: proposal.id, title: '保持现有页面结构', instruction: '修改页面时保留现有布局。',
  });
  assert.equal(approved.revision, 1);
  assert.equal(approved.rules[0].status, 'active');
  assert.match(spaceLearningContext(approved), /修改页面时保留现有布局/);
  const disabled = updateSpaceLearning(approved, { action: 'disable_rule', id: approved.rules[0].id });
  assert.equal(spaceLearningContext(disabled), '');
});

test('space learning writes generated README separately from state', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-learning-'));
  const options = { projectRoot, userId: 'user-1', spaceId: 'space-1' };
  const merged = mergeSpaceLearningCandidates(emptySpaceLearning(), extractSpaceLearningCandidates([failedRun()])).state;
  const approvedProposal = merged.proposals[0];
  const unapprovedProposal = merged.proposals[1];
  const state = updateSpaceLearning(merged, { action: 'approve', id: approvedProposal.id });
  await writeSpaceLearning(options, state);
  const stored = await readSpaceLearning(options);
  const readme = await readFile(spaceLearningPaths(options).readme, 'utf8');
  assert.equal(stored.revision, 1);
  assert.match(readme, /# 空间成长手册/);
  assert.match(readme, /累计发现：1 次/);
  assert.equal(readme.includes(unapprovedProposal.instruction), false);
});
