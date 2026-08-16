import { randomUUID } from 'node:crypto';
import { coordinatorWakeupKey, taskCompletionKey } from '../../lib/agent-runtime-v2-policy.mjs';
import { appendRunEvent } from './event-store.mjs';
import { enqueueRuntimeIntent, OUTBOX_KINDS } from './runtime-outbox.mjs';

function json(value, fallback) {
  return JSON.stringify(value ?? fallback);
}

export function submitTaskCompletion(db, submission, timestamp = new Date().toISOString()) {
  const key = taskCompletionKey(submission.taskId, submission.attempt);
  return db.transaction(() => {
    const existing = db.prepare(
      'SELECT * FROM "AgentTaskCompletion" WHERE "idempotencyKey" = ?'
    ).get(key);
    if (existing) return existing;

    const changed = db.prepare(
      `UPDATE "AgentTask"
       SET "status" = 'SUBMITTED', "result" = ?, "submittedAt" = ?, "completedAt" = NULL,
           "reviewDecision" = NULL, "reviewSummary" = NULL, "updatedAt" = ?
       WHERE "id" = ? AND "runId" = ? AND "attempt" = ? AND "status" = 'RUNNING'`
    ).run(submission.report, timestamp, timestamp, submission.taskId, submission.runId, submission.attempt);
    if (changed.changes !== 1) throw new Error('任务已停止或已经提交');

    const id = randomUUID();
    db.prepare(
      `INSERT INTO "AgentTaskCompletion"
       ("id", "runId", "taskId", "attempt", "workerId", "status", "report", "evidence",
        "artifacts", "validation", "idempotencyKey", "active", "createdAt")
       VALUES (?, ?, ?, ?, ?, 'SUBMITTED', ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      id,
      submission.runId,
      submission.taskId,
      submission.attempt,
      submission.workerId,
      submission.report,
      json(submission.evidence, []),
      json(submission.artifacts, []),
      json(submission.validation, {}),
      key,
      timestamp
    );

    const event = appendRunEvent(db, {
      runId: submission.runId,
      type: 'TASK_SUBMITTED',
      message: `${submission.agentName || '成员'}已提交工作，等待协调者验收`,
      payload: {
        completionId: id,
        taskId: submission.taskId,
        agentId: submission.agentId,
        attempt: submission.attempt,
        actor: 'worker',
      },
      idempotencyKey: `task-submitted:${key}`,
      taskId: submission.taskId,
      agentId: submission.agentId,
      attempt: submission.attempt,
      actor: 'worker',
    }, timestamp);

    enqueueRuntimeIntent(db, {
      runId: submission.runId,
      kind: OUTBOX_KINDS.COORDINATOR_WAKEUP,
      aggregateId: id,
      idempotencyKey: coordinatorWakeupKey(id),
      payload: { completionId: id, triggerEventId: event.id },
    }, timestamp);

    db.prepare(
      `INSERT INTO "AgentSession"
       ("id", "spaceId", "agentId", "status", "currentTaskId", "worklog", "summary",
        "lastActiveAt", "createdAt", "updatedAt")
       VALUES (?, ?, ?, 'AWAITING_REVIEW', ?, ?, ?, ?, ?, ?)
       ON CONFLICT("spaceId", "agentId") DO UPDATE SET
         "status" = excluded."status", "currentTaskId" = excluded."currentTaskId",
         "worklog" = excluded."worklog", "summary" = excluded."summary",
         "lastActiveAt" = excluded."lastActiveAt", "updatedAt" = excluded."updatedAt"`
    ).run(
      randomUUID(), submission.spaceId, submission.agentId, submission.taskId,
      json(submission.worklog, []), submission.report.slice(0, 2000), timestamp, timestamp, timestamp
    );

    return db.prepare('SELECT * FROM "AgentTaskCompletion" WHERE "id" = ?').get(id);
  })();
}
