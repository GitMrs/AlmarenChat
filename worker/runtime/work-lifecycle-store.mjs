import { randomUUID } from 'node:crypto';
import { automationResultHash, deliveryStatusFor } from './automation-delivery-store.mjs';

export function advanceWorkAfterRun(db, { workId, runStatus, timestamp }) {
  if (!workId || runStatus !== 'COMPLETED') return false;
  const result = db.prepare(
    `UPDATE "SpaceWork"
     SET "status" = 'ACTIVE', "stage" = 'review', "completedAt" = NULL, "updatedAt" = ?
     WHERE "id" = ?`
  ).run(timestamp, workId);
  return result.changes > 0;
}

const TERMINAL_RUN_STATUSES = new Set(['COMPLETED', 'PARTIAL', 'FAILED_VALIDATION', 'FAILED', 'BLOCKED', 'CANCELLED']);

export function completeAutomationExecution(db, { runId, runStatus, result, error, timestamp }) {
  if (!runId || !TERMINAL_RUN_STATUSES.has(runStatus)) return false;
  let execution;
  try {
    execution = db.prepare(
      `SELECT execution."id", execution."automationId", automation."completionAction"
       FROM "SpaceAutomationExecution" execution
       JOIN "SpaceAutomation" automation ON automation."id" = execution."automationId"
       WHERE execution."runId" = ? LIMIT 1`
    ).get(runId);
  } catch (error) {
    if (error?.code === 'SQLITE_ERROR' && /no such table/i.test(error.message)) return false;
    throw error;
  }
  if (!execution) return false;
  const successful = runStatus === 'COMPLETED';
  const deliveredResult = successful ? String(result || '').trim().slice(0, 12_000) : null;
  const failureMessage = successful ? null : String(error || `自动化任务以 ${runStatus} 结束`).slice(0, 2000);
  db.prepare(
    `UPDATE "SpaceAutomationExecution"
     SET "status" = ?, "result" = ?, "resultHash" = ?,
         "deliveryStatus" = CASE WHEN "deliveryStatus" = 'NOT_REQUIRED' THEN ? ELSE "deliveryStatus" END,
         "error" = ?, "updatedAt" = ? WHERE "id" = ?`
  ).run(
    successful ? 'COMPLETED' : runStatus,
    deliveredResult,
    successful ? automationResultHash(deliveredResult) : null,
    successful ? deliveryStatusFor(execution.completionAction) : 'NOT_REQUIRED',
    failureMessage,
    timestamp,
    execution.id
  );
  if (successful) {
    db.prepare(
      `UPDATE "SpaceAutomation" SET "consecutiveFailures" = 0, "lastError" = NULL, "updatedAt" = ? WHERE "id" = ?`
    ).run(timestamp, execution.automationId);
    requestAutomatedWorkFinalization(db, { executionId: execution.id, runId, timestamp });
  } else {
    db.prepare(
      `UPDATE "SpaceAutomation"
       SET "enabled" = 0, "consecutiveFailures" = "consecutiveFailures" + 1, "lastError" = ?, "updatedAt" = ?
       WHERE "id" = ?`
    ).run(failureMessage, timestamp, execution.automationId);
  }
  return true;
}

export function requestAutomatedWorkFinalization(db, { executionId, runId, timestamp }) {
  let context;
  try {
    context = db.prepare(
      `SELECT run."spaceId", run."workId", work."title" AS "workTitle", space."templateSnapshot",
              automation."completionAction", automation."completionConfig"
       FROM "AgentRun" run
       JOIN "Space" space ON space."id" = run."spaceId"
       LEFT JOIN "SpaceWork" work ON work."id" = run."workId"
       LEFT JOIN "SpaceAutomationExecution" execution ON execution."id" = ?
       LEFT JOIN "SpaceAutomation" automation ON automation."id" = execution."automationId"
       WHERE run."id" = ? LIMIT 1`
    ).get(executionId, runId);
  } catch (error) {
    if (error?.code === 'SQLITE_ERROR' && /no such table/i.test(error.message)) return null;
    throw error;
  }
  if (!context?.spaceId || !context?.workId) return null;
  if (context.completionAction === 'WEBHOOK_NOTIFY') return null;
  let snapshot = null;
  try {
    snapshot = typeof context.templateSnapshot === 'string' ? JSON.parse(context.templateSnapshot) : context.templateSnapshot;
  } catch {
    snapshot = null;
  }
  let completionConfig = null;
  try {
    completionConfig = typeof context.completionConfig === 'string'
      ? JSON.parse(context.completionConfig)
      : context.completionConfig;
  } catch {
    completionConfig = null;
  }
  const id = randomUUID();
  const idempotencyKey = `automation-finalize:${executionId}`;
  const payload = JSON.stringify({
    workTitle: context.workTitle || '自动化成果',
    defaultArtifacts: Array.isArray(snapshot?.defaultArtifacts) ? snapshot.defaultArtifacts : [],
    completionCriteria: Array.isArray(snapshot?.completionCriteria) ? snapshot.completionCriteria : [],
    completionAction: ['WECHAT_CREATE_DRAFT', 'WEBHOOK_NOTIFY'].includes(context.completionAction) ? context.completionAction : 'NONE',
    completionConfig: ['WECHAT_CREATE_DRAFT', 'WEBHOOK_NOTIFY'].includes(context.completionAction) ? completionConfig : null,
  });
  const inserted = db.prepare(
    `INSERT OR IGNORE INTO "SpaceActionRequest"
     ("id", "spaceId", "workId", "runId", "automationExecutionId", "kind", "riskLevel", "title",
      "status", "payload", "idempotencyKey", "requestedAt", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?, 'FINALIZE_WORK', 'MEDIUM', ?, 'PENDING', ?, ?, ?, ?, ?)`
  ).run(
    id,
    context.spaceId,
    context.workId,
    runId,
    executionId,
    `确认定稿：${context.workTitle || '自动化成果'}`.slice(0, 160),
    payload,
    idempotencyKey,
    timestamp,
    timestamp,
    timestamp
  );
  if (inserted.changes !== 1) {
    return db.prepare('SELECT "id" FROM "SpaceActionRequest" WHERE "idempotencyKey" = ?').get(idempotencyKey) || null;
  }
  db.prepare(
    `INSERT OR IGNORE INTO "SpaceMessage"
     ("id", "spaceId", "role", "speakerAgentId", "content", "attachments", "sourceKey", "createdAt")
     VALUES (?, ?, 'assistant', 'space-coordinator', ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    context.spaceId,
    `自动化成果“${context.workTitle || '未命名'}”已完成执行，等待你确认定稿。`,
    JSON.stringify([{ type: 'action_request', actionId: id, kind: 'FINALIZE_WORK', workId: context.workId, runId }]),
    `action-request:${idempotencyKey}`,
    timestamp
  );
  return { id };
}
