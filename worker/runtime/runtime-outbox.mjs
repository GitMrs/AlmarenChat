import { randomUUID } from 'node:crypto';

export const OUTBOX_KINDS = Object.freeze({
  COORDINATOR_WAKEUP: 'COORDINATOR_WAKEUP',
  CHAT_PROJECTION: 'CHAT_PROJECTION',
  FINAL_DELIVERY: 'FINAL_DELIVERY',
});

export function enqueueRuntimeIntent(db, intent, timestamp = new Date().toISOString()) {
  if (!intent?.runId || !intent?.kind || !intent?.aggregateId || !intent?.idempotencyKey) {
    throw new Error('Runtime Outbox intent 不完整');
  }
  db.prepare(
    `INSERT OR IGNORE INTO "AgentRuntimeOutbox"
      ("id", "runId", "kind", "aggregateId", "idempotencyKey", "payload", "status",
       "attempts", "availableAt", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?, ?)`
  ).run(
    randomUUID(),
    intent.runId,
    intent.kind,
    intent.aggregateId,
    intent.idempotencyKey,
    JSON.stringify(intent.payload || {}),
    timestamp,
    timestamp,
    timestamp
  );
  return db.prepare(
    'SELECT * FROM "AgentRuntimeOutbox" WHERE "idempotencyKey" = ?'
  ).get(intent.idempotencyKey);
}

export function claimRuntimeIntent(db, workerId, timestamp = new Date().toISOString()) {
  return db.transaction(() => {
    const row = db.prepare(
      `SELECT * FROM "AgentRuntimeOutbox"
       WHERE "status" IN ('PENDING', 'FAILED') AND "attempts" < 8 AND "availableAt" <= ?
       ORDER BY "createdAt" ASC LIMIT 1`
    ).get(timestamp);
    if (!row) return null;
    const claimed = db.prepare(
      `UPDATE "AgentRuntimeOutbox"
       SET "status" = 'PROCESSING', "attempts" = "attempts" + 1,
           "claimedBy" = ?, "claimedAt" = ?, "updatedAt" = ?
       WHERE "id" = ? AND "status" IN ('PENDING', 'FAILED')`
    ).run(workerId, timestamp, timestamp, row.id);
    return claimed.changes === 1
      ? { ...row, status: 'PROCESSING', attempts: row.attempts + 1, claimedBy: workerId, claimedAt: timestamp }
      : null;
  })();
}

export function completeRuntimeIntent(db, id, timestamp = new Date().toISOString()) {
  return db.prepare(
    `UPDATE "AgentRuntimeOutbox"
     SET "status" = 'DELIVERED', "lastError" = NULL, "claimedBy" = NULL, "claimedAt" = NULL,
         "deliveredAt" = ?, "updatedAt" = ?
     WHERE "id" = ? AND "status" = 'PROCESSING'`
  ).run(timestamp, timestamp, id).changes === 1;
}

export function failRuntimeIntent(db, entry, error, timestamp = new Date().toISOString()) {
  const message = error instanceof Error ? error.message : String(error);
  const retryAt = new Date(
    Date.parse(timestamp) + Math.min(120_000, Math.max(1, Number(entry.attempts) || 1) * 5_000)
  ).toISOString();
  db.prepare(
    `UPDATE "AgentRuntimeOutbox"
     SET "status" = 'FAILED', "lastError" = ?, "availableAt" = ?,
         "claimedBy" = NULL, "claimedAt" = NULL, "updatedAt" = ?
     WHERE "id" = ? AND "status" = 'PROCESSING'`
  ).run(message.slice(0, 2_000), retryAt, timestamp, entry.id);
}

export function recoverRuntimeIntents(db, staleBefore, timestamp = new Date().toISOString()) {
  return db.prepare(
    `UPDATE "AgentRuntimeOutbox"
     SET "status" = 'PENDING', "claimedBy" = NULL, "claimedAt" = NULL, "updatedAt" = ?
     WHERE "status" = 'PROCESSING' AND ("claimedAt" IS NULL OR "claimedAt" <= ?)`
  ).run(timestamp, staleBefore).changes;
}
