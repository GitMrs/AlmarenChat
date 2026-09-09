import { randomUUID } from 'node:crypto';
import { automationAuthorization, nextScheduledAutomationRunAt } from '../../lib/space-automation-policy.mjs';

const ACTIVE_RUN_STATUSES = ['QUEUED', 'PLANNING', 'RUNNING', 'WAITING', 'WAITING_APPROVAL', 'SUMMARIZING', 'CANCEL_REQUESTED'];
const ACTIVE_RELAY_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'CANCEL_REQUESTED'];

function placeholders(values) {
  return values.map(() => '?').join(', ');
}

function parseSnapshot(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function parseWeekdays(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function workTitle(automation, timestamp) {
  const stamp = timestamp.slice(0, 16).replace('T', ' ');
  return `${automation.name} · ${stamp}`.slice(0, 120);
}

export function triggerNextDueAutomation(db, timestamp = new Date().toISOString()) {
  return db.transaction(() => {
    const automation = db.prepare(
      `SELECT automation.*, space."userId", space."templateId", space."templateSnapshot",
              space."executionEngine", space."runtimeType", space."activeWorkId"
       FROM "SpaceAutomation" automation
       JOIN "Space" space ON space."id" = automation."spaceId"
       WHERE automation."enabled" = 1 AND automation."deletedAt" IS NULL AND automation."nextRunAt" <= ? AND space."runtimeType" <> 'PI_CODING'
       ORDER BY automation."nextRunAt" ASC, automation."createdAt" ASC
       LIMIT 1`
    ).get(timestamp);
    if (!automation) return null;

    const activeRun = db.prepare(
      `SELECT 1 FROM "AgentRun" WHERE "spaceId" = ? AND "status" IN (${placeholders(ACTIVE_RUN_STATUSES)}) LIMIT 1`
    ).get(automation.spaceId, ...ACTIVE_RUN_STATUSES);
    const activeRelay = db.prepare(
      `SELECT 1 FROM "SpaceRelay" WHERE "spaceId" = ? AND "status" IN (${placeholders(ACTIVE_RELAY_STATUSES)}) LIMIT 1`
    ).get(automation.spaceId, ...ACTIVE_RELAY_STATUSES);
    if (activeRun || activeRelay) return null;
    const hasMember = db.prepare('SELECT 1 FROM "SpaceMember" WHERE "spaceId" = ? LIMIT 1').get(automation.spaceId);
    if (!hasMember) {
      db.prepare(
        `UPDATE "SpaceAutomation" SET "enabled" = 0, "lastError" = ?, "updatedAt" = ? WHERE "id" = ?`
      ).run('空间没有可用成员，自动化已暂停', timestamp, automation.id);
      return { automationId: automation.id, status: 'PAUSED', reason: 'NO_MEMBERS' };
    }

    const scheduledFor = automation.nextRunAt;
    const nextRunAt = nextScheduledAutomationRunAt(
      { ...automation, weekdays: parseWeekdays(automation.weekdays) },
      scheduledFor,
      timestamp
    ).toISOString();
    const runId = randomUUID();
    const executionId = randomUUID();
    const snapshot = parseSnapshot(automation.templateSnapshot);
    const authorization = automationAuthorization(automation, snapshot);
    const input = String(automation.prompt || '').trim();
    let work = automation.workStrategy === 'ACTIVE_WORK' && automation.activeWorkId
      ? db.prepare(`SELECT * FROM "SpaceWork" WHERE "id" = ? AND "spaceId" = ? AND "status" <> 'ARCHIVED'`).get(
          automation.activeWorkId,
          automation.spaceId
        )
      : null;
    if (!work) {
      work = {
        id: randomUUID(),
        title: workTitle(automation, timestamp),
        kind: automation.templateId || 'general',
      };
      db.prepare(
        `INSERT INTO "SpaceWork"
         ("id", "spaceId", "title", "kind", "status", "stage", "objective", "createdAt", "updatedAt")
         VALUES (?, ?, ?, ?, 'ACTIVE', 'production', ?, ?, ?)`
      ).run(work.id, automation.spaceId, work.title, work.kind, input.slice(0, 4000), timestamp, timestamp);
    } else {
      db.prepare(
        `UPDATE "SpaceWork" SET "status" = 'ACTIVE', "stage" = 'production', "completedAt" = NULL,
         "objective" = COALESCE("objective", ?), "updatedAt" = ? WHERE "id" = ?`
      ).run(input.slice(0, 4000), timestamp, work.id);
    }

    const coordinatorState = JSON.stringify({
      phase: 'coordinating',
      authorizedAt: timestamp,
      automated: true,
      automationId: automation.id,
      iteration: 0,
      taskCount: 0,
      currentTaskIds: [],
      authorization,
    });
    db.prepare(
      `INSERT INTO "AgentRun"
       ("id", "spaceId", "userId", "input", "status", "workId", "attempt", "modelRequestCount",
        "modelRequestLimit", "executionEngine", "engineVersion", "runtimeVersion", "eventSequence",
        "coordinatorState", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, 'QUEUED', ?, 1, 0, 48, ?, '1', 3, 1, ?, ?, ?)`
    ).run(
      runId,
      automation.spaceId,
      automation.userId,
      input,
      work.id,
      automation.executionEngine === 'pi' ? 'pi' : 'native',
      coordinatorState,
      timestamp,
      timestamp
    );
    db.prepare(
      `INSERT INTO "AgentRunEvent"
       ("id", "runId", "type", "message", "payload", "idempotencyKey", "sequence", "actor", "createdAt")
       VALUES (?, ?, 'RUN_QUEUED', ?, ?, ?, 1, 'automation', ?)`
    ).run(
      randomUUID(),
      runId,
      `自动化“${automation.name}”已到期，等待协调者安排工作`,
      JSON.stringify({ automationId: automation.id, executionId, scheduledFor, authorization }),
      `automation:${automation.id}:${scheduledFor}`,
      timestamp
    );
    db.prepare(
      `INSERT INTO "SpaceAutomationExecution"
       ("id", "automationId", "scheduledFor", "status", "runId", "createdAt", "updatedAt")
       VALUES (?, ?, ?, 'TRIGGERED', ?, ?, ?)`
    ).run(executionId, automation.id, scheduledFor, runId, timestamp, timestamp);
    db.prepare(
      `INSERT INTO "SpaceMessage" ("id", "spaceId", "role", "speakerAgentId", "content", "attachments", "sourceKey", "createdAt")
       VALUES (?, ?, 'assistant', 'space-coordinator', ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      automation.spaceId,
      `自动化“${automation.name}”已开始执行。`,
      JSON.stringify([{ type: 'automation_trigger', automationId: automation.id, executionId, runId, scheduledFor }]),
      `automation-trigger:${executionId}`,
      timestamp
    );
    db.prepare(
      `UPDATE "SpaceAutomation"
       SET "nextRunAt" = ?, "lastRunAt" = ?, "lastRunId" = ?, "lastError" = NULL, "updatedAt" = ?
       WHERE "id" = ? AND "nextRunAt" = ?`
    ).run(nextRunAt, timestamp, runId, timestamp, automation.id, scheduledFor);
    db.prepare('UPDATE "Space" SET "activeWorkId" = ?, "updatedAt" = ? WHERE "id" = ?').run(
      work.id,
      timestamp,
      automation.spaceId
    );
    return { automationId: automation.id, executionId, runId, workId: work.id, status: 'TRIGGERED', nextRunAt };
  }).immediate();
}
