import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  claimNextAutomationDelivery,
  completeAutomationDelivery,
  failAutomationDelivery,
  recoverAutomationDeliveries,
} from './automation-delivery-store.mjs';

function database() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE "SpaceAutomationExecution" (
    "id" TEXT PRIMARY KEY, "automationId" TEXT, "runId" TEXT, "status" TEXT,
    "result" TEXT, "deliveryStatus" TEXT, "deliveryAttempts" INTEGER,
    "deliveryError" TEXT, "deliveryNextAttemptAt" TEXT, "deliveredAt" TEXT,
    "createdAt" TEXT, "updatedAt" TEXT
  )`);
  return db;
}

test('delivery claims are isolated by execution and become durable receipts', () => {
  const db = database();
  try {
    db.prepare('INSERT INTO "SpaceAutomationExecution" VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)').run(
      'exec-1', 'auto-1', 'run-1', 'COMPLETED', '日报内容', 'PENDING', 0, 'before', 'before'
    );
    const delivery = claimNextAutomationDelivery(db, '2026-09-22T10:00:00.000Z');
    assert.equal(delivery.id, 'exec-1');
    assert.equal(delivery.deliveryAttempts, 1);
    completeAutomationDelivery(db, delivery.id, '2026-09-22T10:00:01.000Z');
    assert.deepEqual(db.prepare('SELECT "deliveryStatus", "deliveredAt" FROM "SpaceAutomationExecution"').get(), {
      deliveryStatus: 'DELIVERED',
      deliveredAt: '2026-09-22T10:00:01.000Z',
    });
  } finally {
    db.close();
  }
});

test('failed deliveries retry with a delay and stop after three attempts', () => {
  const db = database();
  try {
    db.prepare('INSERT INTO "SpaceAutomationExecution" VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)').run(
      'exec-1', 'auto-1', 'COMPLETED', '日报内容', 'PENDING', 0, 'before', 'before'
    );
    let delivery = claimNextAutomationDelivery(db, '2026-09-22T10:00:00.000Z');
    let failed = failAutomationDelivery(db, delivery, new Error('HTTP 500'), '2026-09-22T10:00:00.000Z');
    assert.equal(failed.retry, true);
    assert.equal(claimNextAutomationDelivery(db, '2026-09-22T10:00:30.000Z'), null);
    delivery = claimNextAutomationDelivery(db, failed.nextAttemptAt);
    failed = failAutomationDelivery(db, delivery, new Error('HTTP 500'), failed.nextAttemptAt);
    delivery = claimNextAutomationDelivery(db, failed.nextAttemptAt);
    failed = failAutomationDelivery(db, delivery, new Error('HTTP 500'), failed.nextAttemptAt);
    assert.equal(failed.retry, false);
    assert.equal(db.prepare('SELECT "deliveryStatus" FROM "SpaceAutomationExecution"').get().deliveryStatus, 'FAILED');
  } finally {
    db.close();
  }
});

test('interrupted delivery claims return to the pending queue', () => {
  const db = database();
  try {
    db.prepare('INSERT INTO "SpaceAutomationExecution" VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)').run(
      'exec-1', 'auto-1', 'COMPLETED', '日报内容', 'DELIVERING', 1, 'before', '2026-09-22T09:00:00.000Z'
    );
    assert.equal(recoverAutomationDeliveries(db, '2026-09-22T09:30:00.000Z'), 1);
    assert.equal(db.prepare('SELECT "deliveryStatus" FROM "SpaceAutomationExecution"').get().deliveryStatus, 'PENDING');
  } finally {
    db.close();
  }
});
