import { completionIdFor } from '../../lib/agent-completion-policy.mjs';
import {
  EXECUTION_BUDGET_WAIT_REASON,
  RESEARCH_SOURCE_WAIT_REASON,
  RUN_BUDGET_WAIT_ERROR,
  normalizeWaitRequest,
} from '../../lib/agent-wait-policy.mjs';
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

  function waitPendingTaskForResearchInput(run, task, issues = []) {
    const timestamp = now();
    const details = Array.isArray(issues) && issues.length > 0
      ? `当前问题：${issues.join('；')}`
      : '当前没有找到可核验且与主题直接相关的来源';
    const question = '请补充目标对象或主题的其他名称、官网或可信资料链接，提交后将从当前任务重新检索。';
    db.transaction(() => {
      const changed = db.prepare(
        `UPDATE "AgentTask"
         SET "status" = 'WAITING', "waitQuestion" = ?, "waitReason" = ?, "waitAnswer" = NULL,
             "waitingAt" = ?, "updatedAt" = ?
         WHERE "id" = ? AND "runId" = ? AND "status" = 'PENDING'`
      ).run(question, RESEARCH_SOURCE_WAIT_REASON, timestamp, timestamp, task.id, run.id);
      if (changed.changes !== 1) throw new Error('当前步骤已经停止');
      db.prepare(
        `UPDATE "AgentRun"
         SET "status" = 'WAITING', "workerId" = NULL, "heartbeatAt" = NULL, "error" = NULL, "updatedAt" = ?
         WHERE "id" = ?`
      ).run(timestamp, run.id);
      addEvent(run.id, 'TASK_WAITING_FOR_RESEARCH_SOURCE', `${task.agentName}等待补充可核验资料`, {
        taskId: task.id,
        agentId: task.agentId,
        question,
        reason: RESEARCH_SOURCE_WAIT_REASON,
        issues,
        attempt: task.attempt,
      });
    })();
    return { ok: true, pause: true, details };
  }

  function waitTaskForExecutionContinuation(run, task, details = {}) {
    const timestamp = now();
    const question = '当前步骤已用完本轮执行额度，需要再增加多少轮继续处理？';
    db.transaction(() => {
      const changed = db.prepare(
        `UPDATE "AgentTask"
         SET "status" = 'WAITING', "waitQuestion" = ?, "waitReason" = ?, "waitAnswer" = NULL,
             "waitingAt" = ?, "updatedAt" = ?
         WHERE "id" = ? AND "runId" = ? AND "status" = 'RUNNING'`
      ).run(question, EXECUTION_BUDGET_WAIT_REASON, timestamp, timestamp, task.id, run.id);
      if (changed.changes !== 1) throw new Error('当前步骤已经停止');
      db.prepare(
        `UPDATE "AgentRun"
         SET "status" = 'WAITING', "workerId" = NULL, "heartbeatAt" = NULL, "updatedAt" = ?
         WHERE "id" = ?`
      ).run(timestamp, run.id);
      addEvent(run.id, 'TASK_WAITING_FOR_CONTINUATION', `${task.agentName}已用完本轮执行额度，等待用户确认继续`, {
        taskId: task.id,
        agentId: task.agentId,
        iterationLimitReached: true,
        checkpointAvailable: true,
        budgetScope: details.budgetScope || 'iterations',
        modelRequestCount: details.modelRequestCount ?? null,
        modelRequestLimit: details.modelRequestLimit ?? null,
        attempt: task.attempt,
      });
    })();
    return true;
  }

  function waitRunForExecutionContinuation(run, error) {
    const timestamp = now();
    db.transaction(() => {
      const changed = db.prepare(
        `UPDATE "AgentRun"
         SET "status" = 'WAITING', "error" = ?, "workerId" = NULL, "heartbeatAt" = NULL, "updatedAt" = ?
         WHERE "id" = ? AND "status" NOT IN ('COMPLETED', 'PARTIAL', 'FAILED', 'FAILED_VALIDATION', 'BLOCKED', 'CANCELLED')`
      ).run(RUN_BUDGET_WAIT_ERROR, timestamp, run.id);
      if (changed.changes !== 1) throw new Error('当前任务已经停止');
      addEvent(run.id, 'RUN_WAITING_FOR_CONTINUATION', '整个任务的模型调用预算已用完，等待用户确认继续', {
        budgetScope: 'run',
        modelRequestCount: error?.count ?? null,
        modelRequestLimit: error?.limit ?? null,
      });
    })();
    return true;
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
    const failedTaskIds = new Set(db.prepare(
      `SELECT "id" FROM "AgentTask" WHERE "runId" = ? AND "status" = 'FAILED'`
    ).all(runId).map((task) => task.id));
    for (const taskId of taskIds) {
      if (!failedTaskIds.has(taskId)) discardTaskWorkspace(runId, taskId);
    }
  }

  return {
    cancelRun,
    cancelTask,
    failRun,
    isCancelRequested,
    isTaskCancelRequested,
    waitRunForExecutionContinuation,
    waitPendingTaskForResearchInput,
    waitTaskForExecutionContinuation,
    waitTaskForUserInput,
  };
}
