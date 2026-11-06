import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import {
  emptySpaceLearning,
  normalizeSpaceLearning,
  extractSpaceLearningCandidates,
  mergeSpaceLearningCandidates,
  readSpaceLearning,
  renderSpaceLearningReadme,
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

test('restoring space rules never activates pending, superseded or unknown states', () => {
  const statuses = ['active', 'disabled', 'pending', 'ignored', 'superseded', 'deleted', 'unknown', undefined];
  const value = { rules: statuses.map((status, index) => ({
    id: `rule-${index}`, status, title: `规则 ${index}`, instruction: `限定规则内容 ${index}`,
  })) };
  const restored = normalizeSpaceLearning(normalizeSpaceLearning(value));
  for (const output of [spaceLearningContext(restored), renderSpaceLearningReadme(restored)]) {
    assert.match(output, /限定规则内容 0/);
    for (let index = 1; index < statuses.length; index++) assert.ok(!output.includes(`限定规则内容 ${index}`));
  }
  for (let index = 2; index < statuses.length; index++) {
    assert.throws(() => updateSpaceLearning(restored, { action: 'enable_rule', id: `rule-${index}` }), /只有已确认/);
  }
  assert.equal(updateSpaceLearning(restored, { action: 'enable_rule', id: 'rule-1' }).rules[1].status, 'active');
});

test('editing confirmed rules preserves versions and never enables disabled rules', async () => {
  const merged = mergeSpaceLearningCandidates(emptySpaceLearning(), extractSpaceLearningCandidates([failedRun()])).state;
  const original = merged.proposals[0];
  let state = updateSpaceLearning(merged, { action: 'approve', id: original.id });
  state = updateSpaceLearning(state, { action: 'disable_rule', id: original.id });
  state = updateSpaceLearning(state, { action: 'update_rule', id: original.id, instruction: '新版检查要求' });
  const old = state.rules.find((item) => item.id === original.id);
  const replacement = state.rules.find((item) => item.id === old.supersededById);
  assert.equal(old.instruction, original.instruction);
  assert.equal(old.status, 'superseded');
  assert.equal(replacement.status, 'disabled');
  assert.equal(replacement.key, old.key);
  assert.equal(spaceLearningContext(state), '');
  for (const action of ['enable_rule', 'disable_rule', 'update_rule']) {
    assert.throws(() => updateSpaceLearning(state, { action, id: old.id, instruction: '覆盖历史' }), /只有已确认/);
  }
  const revision = state.revision;
  state = updateSpaceLearning(state, { action: 'update_rule', id: replacement.id, instruction: replacement.instruction });
  assert.equal(state.revision, revision);
  assert.equal(state.rules.length, 2);

  const options = { projectRoot: await mkdtemp(path.join(os.tmpdir(), 'almaren-learning-')), userId: 'user-1', spaceId: 'space-1' };
  await writeSpaceLearning(options, state);
  state = await readSpaceLearning(options);
  assert.equal(state.rules[0].supersededById, replacement.id);
  state = updateSpaceLearning(state, { action: 'enable_rule', id: replacement.id });
  assert.match(spaceLearningContext(state), /新版检查要求/);
  assert.equal(spaceLearningContext(state).includes(original.instruction), false);
  const reverted = updateSpaceLearning(state, { action: 'update_rule', id: replacement.id, instruction: original.instruction });
  assert.equal(reverted.rules.length, 3);
  assert.equal(reverted.rules[1].supersededById, reverted.rules[2].id);
  assert.equal(reverted.rules[2].status, 'active');
});

test('recurring evidence updates the current version without reviving historical or disabled rules', () => {
  const candidates = extractSpaceLearningCandidates([failedRun()]);
  let state = mergeSpaceLearningCandidates(emptySpaceLearning(), candidates).state;
  const original = state.proposals[0];
  state = updateSpaceLearning(state, { action: 'approve', id: original.id });
  state = updateSpaceLearning(state, { action: 'update_rule', id: original.id, instruction: '新的用户约定' });
  const replacement = state.rules[1];
  state = updateSpaceLearning(state, { action: 'disable_rule', id: replacement.id });
  const recurring = extractSpaceLearningCandidates([failedRun('run-2')]);
  const result = mergeSpaceLearningCandidates(state, recurring);
  assert.equal(result.state.rules[0].occurrences, 1);
  assert.equal(result.state.rules[0].status, 'superseded');
  assert.equal(result.state.rules[1].occurrences, 2);
  assert.equal(result.state.rules[1].status, 'disabled');
  assert.equal(result.state.proposals.length, state.proposals.length);
  assert.equal(mergeSpaceLearningCandidates(result.state, recurring).changed, false);
  assert.equal(spaceLearningContext(result.state), '');
});

test('historical versions have a separate bound and cannot evict current rules', () => {
  let state = normalizeSpaceLearning({ rules: [
    { id: 'other', status: 'active', title: '其他规则', instruction: '保留其他有效规则' },
    { id: 'edit', status: 'disabled', title: '编辑规则', instruction: '初始正文' },
  ] });
  let id = 'edit';
  for (let index = 0; index < 110; index++) {
    state = normalizeSpaceLearning(updateSpaceLearning(state, { action: 'update_rule', id, instruction: `第 ${index} 版` }));
    id = state.rules.at(-1).id;
  }
  assert.equal(state.rules.filter((item) => item.status === 'superseded').length, 100);
  assert.equal(state.rules.find((item) => item.id === 'other').status, 'active');
  assert.equal(state.rules.at(-1).status, 'disabled');
  assert.match(spaceLearningContext(state), /保留其他有效规则/);
});
