import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX_DELIVERY_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000];

export function automationResultHash(result) {
  return createHash('sha256').update(String(result || ''), 'utf8').digest('hex');
}

export function deliveryStatusFor(completionAction) {
  return completionAction === 'WEBHOOK_NOTIFY' ? 'PENDING' : 'NOT_REQUIRED';
}

export function writeAutomationDeliveryReceipts({ projectRoot, userId, spaceId, automationId, executionId, db }) {
  const relativePath = `.automation/${automationId}/delivery-receipts.json`;
  const target = path.resolve(projectRoot, 'data', 'spaces', userId, spaceId, 'workspace', relativePath);
  const receipts = db.prepare(
    `SELECT "id" AS "executionId", "scheduledFor", "workId", "resultHash", "result", "deliveredAt"
     FROM "SpaceAutomationExecution"
     WHERE "automationId" = ? AND "deliveryStatus" = 'DELIVERED'
     ORDER BY "deliveredAt" DESC LIMIT 50`
  ).all(automationId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ version: 1, automationId, receipts }, null, 2), 'utf8');
  return {
    SPACE_AUTOMATION_ID: automationId,
    SPACE_AUTOMATION_EXECUTION_ID: executionId,
    SPACE_AUTOMATION_RECEIPTS_PATH: relativePath,
  };
}

export function recoverAutomationDeliveries(db, cutoff) {
  return db.prepare(
    `UPDATE "SpaceAutomationExecution"
     SET "deliveryStatus" = 'PENDING', "deliveryError" = '推送进程中断，等待重试', "updatedAt" = ?
     WHERE "deliveryStatus" = 'DELIVERING' AND "updatedAt" < ?`
  ).run(new Date().toISOString(), cutoff).changes;
}

export function claimNextAutomationDelivery(db, timestamp) {
  return db.transaction(() => {
    const delivery = db.prepare(
      `SELECT execution."id", execution."automationId", execution."runId", execution."result",
              execution."deliveryAttempts"
       FROM "SpaceAutomationExecution" execution
       WHERE execution."status" = 'COMPLETED'
         AND execution."deliveryStatus" = 'PENDING'
         AND (execution."deliveryNextAttemptAt" IS NULL OR execution."deliveryNextAttemptAt" <= ?)
       ORDER BY execution."createdAt" ASC LIMIT 1`
    ).get(timestamp);
    if (!delivery) return null;
    const claimed = db.prepare(
      `UPDATE "SpaceAutomationExecution"
       SET "deliveryStatus" = 'DELIVERING', "deliveryAttempts" = "deliveryAttempts" + 1,
           "deliveryError" = NULL, "updatedAt" = ?
       WHERE "id" = ? AND "deliveryStatus" = 'PENDING'`
    ).run(timestamp, delivery.id);
    return claimed.changes === 1 ? { ...delivery, deliveryAttempts: delivery.deliveryAttempts + 1 } : null;
  }).immediate();
}

export function completeAutomationDelivery(db, executionId, timestamp) {
  db.prepare(
    `UPDATE "SpaceAutomationExecution"
     SET "deliveryStatus" = 'DELIVERED', "deliveredAt" = ?, "deliveryNextAttemptAt" = NULL,
         "deliveryError" = NULL, "updatedAt" = ? WHERE "id" = ?`
  ).run(timestamp, timestamp, executionId);
}

export function failAutomationDelivery(db, delivery, error, timestamp) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  const retry = delivery.deliveryAttempts < MAX_DELIVERY_ATTEMPTS;
  const nextAttemptAt = retry
    ? new Date(new Date(timestamp).getTime() + RETRY_DELAYS_MS[delivery.deliveryAttempts - 1]).toISOString()
    : null;
  db.prepare(
    `UPDATE "SpaceAutomationExecution"
     SET "deliveryStatus" = ?, "deliveryError" = ?, "deliveryNextAttemptAt" = ?, "updatedAt" = ?
     WHERE "id" = ?`
  ).run(retry ? 'PENDING' : 'FAILED', message, nextAttemptAt, timestamp, delivery.id);
  return { retry, nextAttemptAt, error: message };
}
