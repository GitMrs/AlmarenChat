import { completionIdFor } from '../../lib/agent-completion-policy.mjs';
import { normalizeWaitRequest } from '../../lib/agent-wait-policy.mjs';
import { cancelRunRecord } from './run-cancellation-store.mjs';
import { executionFailureStatus } from '../policies/run-policy.mjs';

function failureEvidence(db, runId) {
  const toolCounts = new Map();
  for (const event of db.prepare(
    `SELECT "payload" FROM "AgentRunEvent" WHERE "runId" = ? AND "type" = 'TOOL_COMPLETED' ORDER BY "sequence"`
  ).all(runId)) {
    try {
      const tool = String(JSON.parse(event.payload || '{}').tool || '').trim();
      if (tool) toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1);
    } catch {
      // Ignore malformed legacy event payloads.
    }
  }
  let stagedChanges = 0;
  let validationChecks = 0;
  try {
    for (const manifest of db.prepare(
      `SELECT "entries", "validation" FROM "AgentArtifactManifest" WHERE "runId" = ?`
    ).all(runId)) {
      try {
        const entries = JSON.parse(manifest.entries || '[]');
        if (Array.isArray(entries)) stagedChanges += entries.length;
      } catch {}
      try {
        const validation = JSON.parse(manifest.validation || '{}');
        if (Array.isArray(validation?.checks)) validationChecks += validation.checks.length;
      } catch {}
    }
  } catch {
    // Legacy databases may not have artifact manifests yet.
  }
  const tools = [...toolCounts.entries()].map(([tool, count]) => `${tool}×${count}`).join('、') || '无';
  return `执行证据：工具记录 ${tools}；未应用到工作区的暂存变更 ${stagedChanges} 项；自动校验 ${validationChecks} 项。任务未完成，暂存内容不会覆盖原工作区文件。`;
}

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
    const evidence = failureEvidence(db, runId);
    const completionError = `${message.slice(0, 3000)}\n\n${evidence}`;
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
        completionError.slice(0, 4000),
        status === 'BLOCKED' ? 'RUN_BLOCKED' : 'RUN_FAILED',
        status === 'BLOCKED' ? '任务缺少必要条件，暂时无法继续' : '任务执行失败',
        { error: message.slice(0, 1000), evidence },
        timestamp
      );
      if (runRecord) persistSpaceMemory(runRecord.spaceId, [{
        type: 'task_run',
        actor: '空间协调者',
        summary: `${runRecord.input}；状态：${status}；${message.slice(0, 400)}；${evidence}`,
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
