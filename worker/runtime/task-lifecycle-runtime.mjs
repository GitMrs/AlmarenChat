import { completionIdFor } from '../../lib/agent-completion-policy.mjs';
import { normalizeWaitRequest } from '../../lib/agent-wait-policy.mjs';
import { cancelRunRecord } from './run-cancellation-store.mjs';
import { executionFailureStatus } from '../policies/run-policy.mjs';

export function createTaskLifecycleRuntime({
  db,
  addEvent,
  stageCompletion,
  discardTaskWorkspace,
  persistSpaceMemory,
  now = () => new Date().toISOString(),
}) {
  function isCancelRequested(runId) {
    const row = db.prepare('SELECT "status" FROM "AgentRun" WHERE "id" = ?').get(runId);
    return !row || row.status === 'CANCEL_REQUESTED' || row.status === 'CANCELLED';
  }

  function isTaskCancelRequested(taskId) {
    const row = db.prepare('SELECT "status" FROM "AgentTask" WHERE "id" = ?').get(taskId);
    return !row || row.status === 'CANCEL_REQUESTED' || row.status === 'CANCELLED';
  }

  function cancelTask(taskId, runId, agentName) {
    const timestamp = now();
    const result = db.transaction(() => {
      const changed = db.prepare(
        `UPDATE "AgentTask" SET "status" = 'CANCELLED', "completedAt" = ?, "updatedAt" = ? WHERE "id" = ? AND "status" IN ('PROPOSED', 'PENDING', 'QUEUED', 'RUNNING', 'WAITING', 'WAITING_USER', 'WAITING_APPROVAL', 'SUBMITTED', 'REVIEWING', 'REVISION_REQUIRED', 'CANCEL_REQUESTED')`
      ).run(timestamp, timestamp, taskId);
      db.prepare(
        `DELETE FROM "SpaceFile" WHERE "taskId" = ? AND "status" IN ('GENERATING', 'WAITING_APPROVAL')`
      ).run(taskId);
      return changed;
    })();
    if (result.changes === 1) {
      discardTaskWorkspace(runId, taskId);
      addEvent(runId, 'TASK_CANCELLED', `${agentName}的步骤已取消`, { taskId });
    }
  }

  function cancelRun(runId) {
    const timestamp = now();
    const cancellation = cancelRunRecord(db, runId, timestamp);
    if (cancellation.outcome === 'MISSING' || cancellation.outcome === 'ALREADY_TERMINAL') return;
    if (cancellation.outcome === 'CANCELLED') {
      persistSpaceMemory(cancellation.run.spaceId, [{
        type: 'task_run',
        actor: '空间协调者',
        summary: `${cancellation.run.input}；状态：CANCELLED`,
        at: timestamp,
        refId: runId,
      }], timestamp);
    }
    for (const taskId of cancellation.taskIds) discardTaskWorkspace(runId, taskId);
  }

  function waitTaskForUserInput(run, task, args) {
    const { question, reason } = normalizeWaitRequest(args);
    const timestamp = now();
    db.transaction(() => {
      const changed = db.prepare(
        `UPDATE "AgentTask"
         SET "status" = 'WAITING', "waitQuestion" = ?, "waitReason" = ?, "waitAnswer" = NULL,
             "waitingAt" = ?, "updatedAt" = ?
         WHERE "id" = ? AND "runId" = ? AND "status" = 'RUNNING'`
      ).run(question, reason, timestamp, timestamp, task.id, run.id);
      if (changed.changes !== 1) throw new Error('当前步骤已经停止');
      db.prepare(
        `UPDATE "AgentRun"
         SET "status" = 'WAITING', "workerId" = NULL, "heartbeatAt" = NULL, "updatedAt" = ?
         WHERE "id" = ?`
      ).run(timestamp, run.id);
      addEvent(run.id, 'TASK_WAITING_FOR_INPUT', `${task.agentName}需要用户补充信息`, {
        taskId: task.id,
        agentId: task.agentId,
        question,
        reason,
        attempt: task.attempt,
      });
    })();
    return { ok: true, pause: true };
  }

  function failRun(runId, error) {
    const runRecord = db.prepare('SELECT "spaceId", "input" FROM "AgentRun" WHERE "id" = ?').get(runId);
    const taskIds = db.prepare('SELECT "id" FROM "AgentTask" WHERE "runId" = ?').all(runId).map((task) => task.id);
    const message = error instanceof Error ? error.message : String(error);
    const status = executionFailureStatus(error);
    const timestamp = now();
    const completionId = completionIdFor(runId);
    db.transaction(() => {
      db.prepare(
        `UPDATE "AgentTask" SET "status" = 'CANCELLED', "completedAt" = ?, "updatedAt" = ? WHERE "runId" = ? AND "status" IN ('PROPOSED', 'PENDING', 'QUEUED', 'RUNNING', 'WAITING', 'WAITING_USER', 'WAITING_APPROVAL', 'SUBMITTED', 'REVIEWING', 'REVISION_REQUIRED', 'CANCEL_REQUESTED')`
      ).run(timestamp, timestamp, runId);
      db.prepare(
        `UPDATE "AgentRun" SET "status" = ?, "workerId" = NULL, "heartbeatAt" = NULL,
         "completionId" = COALESCE("completionId", ?), "error" = ?, "completedAt" = ?, "updatedAt" = ? WHERE "id" = ?`
      ).run(status, completionId, message.slice(0, 4000), timestamp, timestamp, runId);
      db.prepare(
        `DELETE FROM "SpaceFile" WHERE "runId" = ? AND "status" IN ('GENERATING', 'WAITING_APPROVAL')`
      ).run(runId);
      if (runRecord) {
        db.prepare(`UPDATE "AgentSession" SET "status" = 'IDLE', "currentTaskId" = NULL, "updatedAt" = ? WHERE "spaceId" = ? AND "status" != 'IDLE'`).run(timestamp, runRecord.spaceId);
      }
      stageCompletion(
        runId,
        completionId,
        status,
        null,
        message.slice(0, 4000),
        status === 'BLOCKED' ? 'RUN_BLOCKED' : 'RUN_FAILED',
        status === 'BLOCKED' ? '任务缺少必要条件，暂时无法继续' : '任务执行失败',
        { error: message.slice(0, 1000) },
        timestamp
      );
      if (runRecord) persistSpaceMemory(runRecord.spaceId, [{
        type: 'task_run',
        actor: '空间协调者',
        summary: `${runRecord.input}；状态：${status}；${message.slice(0, 600)}`,
        at: timestamp,
        refId: runId,
      }], timestamp);
    })();
    for (const taskId of taskIds) discardTaskWorkspace(runId, taskId);
  }

  return {
    cancelRun,
    cancelTask,
    failRun,
    isCancelRequested,
    isTaskCancelRequested,
    waitTaskForUserInput,
  };
}
