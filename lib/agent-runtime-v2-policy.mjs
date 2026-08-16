export const RUNTIME_VERSION = 2;

export const RUN_STATES = Object.freeze({
  QUEUED: 'QUEUED',
  ACTIVE: 'ACTIVE',
  WAITING_USER: 'WAITING_USER',
  COMPLETED: 'COMPLETED',
  PARTIAL: 'PARTIAL',
  BLOCKED: 'BLOCKED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

export const TASK_STATES = Object.freeze({
  PROPOSED: 'PROPOSED',
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  WAITING_USER: 'WAITING_USER',
  SUBMITTED: 'SUBMITTED',
  REVIEWING: 'REVIEWING',
  REVISION_REQUIRED: 'REVISION_REQUIRED',
  COMPLETED: 'COMPLETED',
  BLOCKED: 'BLOCKED',
  CANCELLED: 'CANCELLED',
});

const TASK_TRANSITIONS = new Map([
  [TASK_STATES.PROPOSED, new Set([TASK_STATES.WAITING_APPROVAL, TASK_STATES.CANCELLED])],
  [TASK_STATES.WAITING_APPROVAL, new Set([TASK_STATES.QUEUED, TASK_STATES.CANCELLED])],
  [TASK_STATES.QUEUED, new Set([TASK_STATES.RUNNING, TASK_STATES.CANCELLED, TASK_STATES.BLOCKED])],
  [TASK_STATES.RUNNING, new Set([TASK_STATES.WAITING_USER, TASK_STATES.SUBMITTED, TASK_STATES.BLOCKED, TASK_STATES.CANCELLED])],
  [TASK_STATES.WAITING_USER, new Set([TASK_STATES.QUEUED, TASK_STATES.CANCELLED])],
  [TASK_STATES.SUBMITTED, new Set([TASK_STATES.REVIEWING])],
  [TASK_STATES.REVIEWING, new Set([TASK_STATES.COMPLETED, TASK_STATES.REVISION_REQUIRED, TASK_STATES.BLOCKED])],
  [TASK_STATES.REVISION_REQUIRED, new Set([TASK_STATES.QUEUED, TASK_STATES.CANCELLED])],
]);

export function assertTaskTransition(from, to) {
  if (from === to) return;
  if (!TASK_TRANSITIONS.get(from)?.has(to)) {
    throw new Error(`非法任务状态迁移：${from} -> ${to}`);
  }
}

export function taskCompletionKey(taskId, attempt) {
  return `task-completion:${taskId}:attempt:${attempt}`;
}

export function coordinatorWakeupKey(completionId) {
  return `coordinator-wakeup:${completionId}`;
}

export function workMessageKey(taskId, attempt) {
  return `agent-work:${taskId}:attempt:${attempt}`;
}

export function reportMessageKey(taskId, attempt) {
  return `agent-report:${taskId}:attempt:${attempt}`;
}

export function readyAuthorizedPlanIndexes(plan, dispatchedIndexes, completedIndexes) {
  const dispatched = new Set(dispatchedIndexes || []);
  const completed = new Set(completedIndexes || []);
  return (Array.isArray(plan) ? plan : [])
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate, index }) => !dispatched.has(index)
      && (Array.isArray(candidate?.dependsOn) ? candidate.dependsOn : [])
        .every((dependency) => completed.has(dependency)))
    .map(({ index }) => index);
}
