import assert from 'node:assert/strict';
import test from 'node:test';
import { retryContextFromRuns } from './run-retry-policy.mjs';

test('retry inherits accepted work and automation identity from an ancestor run', () => {
  const context = retryContextFromRuns([
    {
      coordinatorState: { authorization: { objective: '写文章' } },
      tasks: [{ id: 'new-proposal', status: 'PROPOSED' }],
    },
    {
      coordinatorState: {
        automated: true,
        automationId: 'automation-1',
        authorization: { objective: '旧授权' },
      },
      tasks: [
        {
          id: 'article', status: 'COMPLETED', reviewDecision: 'accept', mode: 'executor', attempt: 1,
          title: '写文章', instruction: '输出 article.md', result: '完成',
          artifactManifests: [{ attempt: 1, status: 'APPLIED', validation: { valid: true } }],
        },
        { id: 'rejected', status: 'COMPLETED', reviewDecision: 'revise' },
      ],
    },
  ]);

  assert.deepEqual(context.authorization, { objective: '写文章' });
  assert.equal(context.automated, true);
  assert.equal(context.automationId, 'automation-1');
  assert.deepEqual(context.completedTasks.map((task) => task.id), ['article']);
});

test('retry only inherits executor tasks with valid applied manifests', () => {
  const context = retryContextFromRuns([{ tasks: [
    {
      id: 'valid', status: 'COMPLETED', reviewDecision: 'accept', mode: 'executor', attempt: 1,
      title: '有效页面', instruction: '创建页面', artifactManifests: [
        { attempt: 1, status: 'APPLIED', validation: { valid: true } },
      ],
    },
    {
      id: 'invalid', status: 'COMPLETED', reviewDecision: 'accept', mode: 'executor', attempt: 1,
      title: '无效页面', instruction: '创建页面', artifactManifests: [
        { attempt: 1, status: 'APPLIED', validation: { valid: false } },
      ],
    },
  ] }]);
  assert.deepEqual(context.completedTasks.map((task) => task.id), ['valid']);
});

test('an inherited task recovers its applied manifest from the ancestor', () => {
  const original = {
    id: 'original', status: 'COMPLETED', reviewDecision: 'accept', mode: 'executor', attempt: 1,
    title: '写文章', instruction: '输出 article.md', result: '完成',
    artifactManifests: [{ id: 'manifest', attempt: 1, status: 'APPLIED', validation: { valid: true } }],
  };
  const inherited = { ...original, id: 'inherited', origin: 'retry_inherited', artifactManifests: [] };
  const context = retryContextFromRuns([{ tasks: [inherited] }, { tasks: [original] }]);
  assert.equal(context.completedEntries[0].task.id, 'inherited');
  assert.equal(context.completedEntries[0].manifest.id, 'manifest');
});
