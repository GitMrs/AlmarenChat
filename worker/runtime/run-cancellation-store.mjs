import { completionIdFor, TERMINAL_RUN_STATUSES } from '../../lib/agent-completion-policy.mjs';
import { enqueueCompletion } from '../completion-outbox.mjs';
import { appendRunEvent } from './event-store.mjs';

export function cancelRunRecord(db, runId, timestamp = new Date().toISOString()) {
  const cancel = db.transaction(() => {
    const run = db.prepare(
      'SELECT "id", "spaceId", "input", "status" FROM "AgentRun" WHERE "id" = ?'
    ).get(runId);
    if (!run) return { outcome: 'MISSING', taskIds: [], run: null };

    const taskIds = db.prepare(
      'SELECT "id" FROM "AgentTask" WHERE "runId" = ?'
    ).all(runId).map((task) => task.id);
    if (run.status === 'CANCELLED') return { outcome: 'ALREADY_CANCELLED', taskIds, run };
    if (TERMINAL_RUN_STATUSES.has(run.status)) return { outcome: 'ALREADY_TERMINAL', taskIds: [], run };

    const completionId = completionIdFor(runId);
    db.prepare(
      `UPDATE "AgentRun" SET "status" = 'CANCELLED', "workerId" = NULL, "heartbeatAt" = NULL,
       "completionId" = COALESCE("completionId", ?), "completedAt" = ?, "updatedAt" = ? WHERE "id" = ?`
    ).run(completionId, timestamp, timestamp, runId);
    db.prepare(
      `UPDATE "AgentTask" SET "status" = 'CANCELLED', "completedAt" = ?, "updatedAt" = ?
       WHERE "runId" = ? AND "status" IN ('PROPOSED', 'PENDING', 'QUEUED', 'RUNNING', 'WAITING',
       'WAITING_USER', 'WAITING_APPROVAL', 'SUBMITTED', 'REVIEWING', 'REVISION_REQUIRED', 'CANCEL_REQUESTED')`
    ).run(timestamp, timestamp, runId);
    db.prepare(
      `DELETE FROM "SpaceFile" WHERE "runId" = ? AND "status" IN ('GENERATING', 'WAITING_APPROVAL')`
    ).run(runId);
    db.prepare(
      `UPDATE "AgentSession" SET "status" = 'IDLE', "currentTaskId" = NULL, "updatedAt" = ?
       WHERE "spaceId" = ? AND "status" != 'IDLE'`
    ).run(timestamp, run.spaceId);

    appendRunEvent(db, {
      runId,
      type: 'RUN_CANCELLED',
      message: '任务已取消',
      idempotencyKey: completionId,
      actor: 'system',
    }, timestamp);
    enqueueCompletion(db, {
      runId,
      spaceId: run.spaceId,
      completionId,
      status: 'CANCELLED',
      result: null,
      error: null,
    }, timestamp);

    return { outcome: 'CANCELLED', taskIds, run };
  });

  // Acquire the write reservation before reading so a concurrent space deletion cannot
  // remove the run between the existence check and the terminal event/outbox writes.
  return cancel.immediate();
}
