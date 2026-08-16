import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TASK_STATES,
  assertTaskTransition,
  coordinatorWakeupKey,
  reportMessageKey,
  taskCompletionKey,
  workMessageKey,
  readyAuthorizedPlanIndexes,
} from './agent-runtime-v2-policy.mjs';

test('runtime v2 accepts the worker submit and coordinator review lifecycle', () => {
  assert.doesNotThrow(() => assertTaskTransition(TASK_STATES.QUEUED, TASK_STATES.RUNNING));
  assert.doesNotThrow(() => assertTaskTransition(TASK_STATES.RUNNING, TASK_STATES.SUBMITTED));
  assert.doesNotThrow(() => assertTaskTransition(TASK_STATES.SUBMITTED, TASK_STATES.REVIEWING));
  assert.doesNotThrow(() => assertTaskTransition(TASK_STATES.REVIEWING, TASK_STATES.REVISION_REQUIRED));
  assert.doesNotThrow(() => assertTaskTransition(TASK_STATES.REVISION_REQUIRED, TASK_STATES.QUEUED));
});

test('runtime v2 rejects bypassing coordinator review', () => {
  assert.throws(
    () => assertTaskTransition(TASK_STATES.SUBMITTED, TASK_STATES.COMPLETED),
    /非法任务状态迁移/
  );
});

test('runtime v2 identities are stable per task attempt and completion', () => {
  assert.equal(taskCompletionKey('task-1', 2), 'task-completion:task-1:attempt:2');
  assert.equal(workMessageKey('task-1', 2), 'agent-work:task-1:attempt:2');
  assert.equal(reportMessageKey('task-1', 2), 'agent-report:task-1:attempt:2');
  assert.equal(
    coordinatorWakeupKey('completion-1'),
    'coordinator-wakeup:completion-1'
  );
});

test('runtime v2 dispatches independent work together and waits for dependencies', () => {
  const plan = [
    { dependsOn: [] },
    { dependsOn: [] },
    { dependsOn: [0, 1] },
  ];
  assert.deepEqual(readyAuthorizedPlanIndexes(plan, [], []), [0, 1]);
  assert.deepEqual(readyAuthorizedPlanIndexes(plan, [0, 1], [0]), []);
  assert.deepEqual(readyAuthorizedPlanIndexes(plan, [0, 1], [0, 1]), [2]);
});
