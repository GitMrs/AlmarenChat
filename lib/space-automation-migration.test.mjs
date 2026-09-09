import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('space automation migrations create an auditable calendar schedule', async () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE "Space" ("id" TEXT PRIMARY KEY)');
    db.exec('CREATE TABLE "AgentRun" ("id" TEXT PRIMARY KEY)');
    for (const migrationName of [
      '20260908240000_add_space_automations',
      '20260908250000_extend_space_automation_schedule',
      '20260908260000_add_space_action_requests',
      '20260908270000_add_space_connectors',
      '20260909010000_extend_connector_execution_polling',
      '20260909020000_add_automation_completion_action',
      '20260909030000_add_space_automation_soft_delete',
    ]) {
      db.exec(await readFile(path.join(projectRoot, 'prisma/migrations', migrationName, 'migration.sql'), 'utf8'));
    }
    const columns = new Set(db.prepare('PRAGMA table_info("SpaceAutomation")').all().map((column) => column.name));
    for (const column of ['scheduleType', 'timeZone', 'scheduleHour', 'scheduleMinute', 'weekdays', 'consecutiveFailures', 'completionAction', 'completionConfig', 'deletedAt']) {
      assert.equal(columns.has(column), true, `missing ${column}`);
    }
    assert.equal(db.prepare('PRAGMA index_list("SpaceAutomation")').all().some((index) => index.name === 'SpaceAutomation_spaceId_deletedAt_idx'), true);
    const indexes = new Set(db.prepare('PRAGMA index_list("SpaceAutomationExecution")').all().map((index) => index.name));
    assert.equal(indexes.has('SpaceAutomationExecution_automationId_scheduledFor_key'), true);
    const actionColumns = new Set(db.prepare('PRAGMA table_info("SpaceActionRequest")').all().map((column) => column.name));
    assert.equal(actionColumns.has('idempotencyKey'), true);
    assert.equal(actionColumns.has('automationExecutionId'), true);
    const connectorColumns = new Set(db.prepare('PRAGMA table_info("SpaceConnector")').all().map((column) => column.name));
    assert.equal(connectorColumns.has('credentialCiphertext'), true);
    assert.equal(connectorColumns.has('accessTokenExpiresAt'), true);
    const connectorIndexes = new Set(db.prepare('PRAGMA index_list("SpaceConnector")').all().map((index) => index.name));
    assert.equal(connectorIndexes.has('SpaceConnector_spaceId_provider_key'), true);
    const executionColumns = new Set(db.prepare('PRAGMA table_info("SpaceConnectorExecution")').all().map((column) => column.name));
    assert.equal(executionColumns.has('externalId'), true);
    assert.equal(executionColumns.has('responseSummary'), true);
    assert.equal(executionColumns.has('nextPollAt'), true);
    assert.equal(executionColumns.has('pollCount'), true);
    assert.equal(db.prepare('PRAGMA index_list("SpaceConnectorExecution")').all().some((index) => index.name === 'SpaceConnectorExecution_actionRequestId_key'), true);
  } finally {
    db.close();
  }
});
