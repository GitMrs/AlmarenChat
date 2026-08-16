import { randomUUID } from 'node:crypto';
import { completionIdFor, completionMessage, TERMINAL_RUN_STATUSES } from '../lib/agent-completion-policy.mjs';

export { completionIdFor } from '../lib/agent-completion-policy.mjs';

export function enqueueCompletion(db, payload, timestamp = new Date().toISOString()) {
  if (!TERMINAL_RUN_STATUSES.has(payload.status)) throw new Error(`不能投递非终态任务：${payload.status}`);
  const completionId = payload.completionId || completionIdFor(payload.runId);
  db.prepare(
    `INSERT OR IGNORE INTO "AgentRunOutbox"
      ("id", "runId", "idempotencyKey", "payload", "status", "attempts", "availableAt", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, 'PENDING', 0, ?, ?, ?)`
  ).run(randomUUID(), payload.runId, completionId, JSON.stringify({ ...payload, completionId }), timestamp, timestamp, timestamp);
  return completionId;
}

export function reconcileCompletionOutbox(db, timestamp = new Date().toISOString()) {
  const rows = db.prepare(
    `SELECT "id" AS "runId", "spaceId", "status", "result", "error", "completionId"
     FROM "AgentRun"
     WHERE "completionId" IS NOT NULL
       AND "status" IN ('COMPLETED', 'PARTIAL', 'FAILED_VALIDATION', 'FAILED', 'BLOCKED', 'CANCELLED')
       AND NOT EXISTS (SELECT 1 FROM "AgentRunOutbox" WHERE "AgentRunOutbox"."runId" = "AgentRun"."id")`
  ).all();
  for (const row of rows) enqueueCompletion(db, row, timestamp);
  return rows.length;
}

export function recoverStaleOutbox(db, staleBefore, timestamp = new Date().toISOString()) {
  return db.prepare(
    `UPDATE "AgentRunOutbox"
     SET "status" = 'PENDING', "claimedBy" = NULL, "claimedAt" = NULL, "updatedAt" = ?
     WHERE "status" = 'PROCESSING' AND ("claimedAt" IS NULL OR "claimedAt" <= ?)`
  ).run(timestamp, staleBefore).changes;
}

export function claimNextCompletion(db, workerId, timestamp = new Date().toISOString()) {
  return db.transaction(() => {
    const row = db.prepare(
      `SELECT * FROM "AgentRunOutbox"
       WHERE "status" IN ('PENDING', 'FAILED') AND "attempts" < 5 AND "availableAt" <= ?
       ORDER BY "createdAt" ASC LIMIT 1`
    ).get(timestamp);
    if (!row) return null;
    const claimed = db.prepare(
      `UPDATE "AgentRunOutbox"
       SET "status" = 'PROCESSING', "attempts" = "attempts" + 1, "claimedBy" = ?, "claimedAt" = ?, "updatedAt" = ?
       WHERE "id" = ? AND "status" IN ('PENDING', 'FAILED')`
    ).run(workerId, timestamp, timestamp, row.id);
    return claimed.changes === 1 ? { ...row, status: 'PROCESSING', attempts: row.attempts + 1, claimedBy: workerId, claimedAt: timestamp } : null;
  })();
}

export function deliverCompletion(db, entry, timestamp = new Date().toISOString()) {
  const payload = typeof entry.payload === 'string' ? JSON.parse(entry.payload) : entry.payload;
  const content = completionMessage(payload);
  db.transaction(() => {
    const runStillExists = db.prepare(
      `SELECT 1 FROM "AgentRun" WHERE "id" = ? AND "spaceId" = ?`
    ).get(payload.runId, payload.spaceId);
    if (!runStillExists) return;
    db.prepare(
      `INSERT OR IGNORE INTO "SpaceMessage"
        ("id", "spaceId", "role", "speakerAgentId", "content", "attachments", "sourceKey", "createdAt")
       VALUES (?, ?, 'assistant', 'space-coordinator', ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      payload.spaceId,
      content,
      JSON.stringify([{ type: 'run_result', runId: payload.runId, status: payload.status }]),
      entry.idempotencyKey,
      timestamp
    );
    db.prepare(`UPDATE "Space" SET "updatedAt" = ? WHERE "id" = ?`).run(timestamp, payload.spaceId);
    db.prepare(
      `UPDATE "AgentRunOutbox"
       SET "status" = 'DELIVERED', "lastError" = NULL, "claimedBy" = NULL, "claimedAt" = NULL,
           "deliveredAt" = ?, "updatedAt" = ?
       WHERE "id" = ? AND "status" = 'PROCESSING'`
    ).run(timestamp, timestamp, entry.id);
  })();
}

export function failCompletion(db, entry, error, timestamp = new Date().toISOString()) {
  const message = error instanceof Error ? error.message : String(error);
  const retryAt = new Date(Date.parse(timestamp) + Math.min(60_000, Math.max(1, entry.attempts) * 5_000)).toISOString();
  db.prepare(
    `UPDATE "AgentRunOutbox"
     SET "status" = 'FAILED', "lastError" = ?, "availableAt" = ?, "claimedBy" = NULL, "claimedAt" = NULL, "updatedAt" = ?
     WHERE "id" = ? AND "status" = 'PROCESSING'`
  ).run(message.slice(0, 2_000), retryAt, timestamp, entry.id);
}
