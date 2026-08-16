import { randomUUID } from 'node:crypto';

export function beginCoordinatorTurn(db, input, timestamp = new Date().toISOString()) {
  return db.transaction(() => {
    const existing = db.prepare(
      'SELECT * FROM "AgentCoordinatorTurn" WHERE "runId" = ? AND "triggerEventId" = ?'
    ).get(input.runId, input.triggerEventId);
    if (existing?.status === 'FAILED') {
      const reclaimed = db.prepare(
        `UPDATE "AgentCoordinatorTurn" SET "status" = 'RUNNING', "error" = NULL, "claimedBy" = ?,
         "claimedAt" = ?, "startedAt" = ?, "updatedAt" = ? WHERE "id" = ? AND "status" = 'FAILED'`
      ).run(input.workerId, timestamp, timestamp, timestamp, existing.id);
      if (reclaimed.changes === 1) {
        return { turn: db.prepare('SELECT * FROM "AgentCoordinatorTurn" WHERE "id" = ?').get(existing.id), claimed: true };
      }
    }
    if (existing) return { turn: existing, claimed: false };
    const id = randomUUID();
    db.prepare(
      `INSERT INTO "AgentCoordinatorTurn"
       ("id", "runId", "triggerEventId", "status", "inputSnapshot", "modelRequestCount",
        "claimedBy", "claimedAt", "startedAt", "createdAt", "updatedAt")
       VALUES (?, ?, ?, 'RUNNING', ?, 0, ?, ?, ?, ?, ?)`
    ).run(id, input.runId, input.triggerEventId, JSON.stringify(input.snapshot || {}), input.workerId,
      timestamp, timestamp, timestamp, timestamp);
    return { turn: db.prepare('SELECT * FROM "AgentCoordinatorTurn" WHERE "id" = ?').get(id), claimed: true };
  })();
}

export function completeCoordinatorTurn(db, turnId, action, timestamp = new Date().toISOString()) {
  return db.prepare(
    `UPDATE "AgentCoordinatorTurn"
     SET "status" = 'COMPLETED', "action" = ?, "claimedBy" = NULL, "claimedAt" = NULL,
         "completedAt" = ?, "updatedAt" = ?
     WHERE "id" = ? AND "status" = 'RUNNING'`
  ).run(JSON.stringify(action), timestamp, timestamp, turnId).changes === 1;
}

export function failCoordinatorTurn(db, turnId, error, timestamp = new Date().toISOString()) {
  const message = error instanceof Error ? error.message : String(error);
  db.prepare(
    `UPDATE "AgentCoordinatorTurn"
     SET "status" = 'FAILED', "error" = ?, "claimedBy" = NULL, "claimedAt" = NULL, "updatedAt" = ?
     WHERE "id" = ? AND "status" = 'RUNNING'`
  ).run(message.slice(0, 2000), timestamp, turnId);
}

export function deferCoordinatorDecision(db, runId, error, timestamp = new Date().toISOString()) {
  const message = error instanceof Error ? error.message : String(error);
  const row = db.prepare('SELECT "coordinatorState" FROM "AgentRun" WHERE "id" = ?').get(runId);
  let state = {};
  try {
    state = row?.coordinatorState ? JSON.parse(row.coordinatorState) : {};
  } catch {
    state = {};
  }
  const nextState = {
    ...state,
    phase: 'coordinating',
    currentTaskIds: [],
  };
  return db.prepare(
    `UPDATE "AgentRun"
     SET "status" = 'BLOCKED', "error" = ?, "coordinatorState" = ?,
         "workerId" = NULL, "heartbeatAt" = NULL, "updatedAt" = ?
     WHERE "id" = ?`
  ).run(
    `已验收当前成果，但协调者暂时无法生成下一步安排：${message}`.slice(0, 4000),
    JSON.stringify(nextState),
    timestamp,
    runId
  ).changes === 1;
}

export function recoverCoordinatorTurns(db, staleBefore, timestamp = new Date().toISOString()) {
  return db.prepare(
    `UPDATE "AgentCoordinatorTurn"
     SET "status" = 'FAILED', "error" = '协调者执行中断，已交由恢复流程重新处理',
         "claimedBy" = NULL, "claimedAt" = NULL, "updatedAt" = ?
     WHERE "status" = 'RUNNING' AND ("claimedAt" IS NULL OR "claimedAt" <= ?)`
  ).run(timestamp, staleBefore).changes;
}
