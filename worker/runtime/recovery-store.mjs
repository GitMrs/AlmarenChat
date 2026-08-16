export function cancellationRequests(db) {
  return {
    tasks: db.prepare(
      `SELECT "id", "runId", "agentName" FROM "AgentTask" WHERE "status" = 'CANCEL_REQUESTED'`
    ).all(),
    runs: db.prepare(
      `SELECT "id" FROM "AgentRun" WHERE "status" = 'CANCEL_REQUESTED'`
    ).all(),
  };
}

export function recoverStaleRunLeases(db, staleBefore, timestamp = new Date().toISOString()) {
  const staleRuns = db.prepare(
    `SELECT "id", "workerId" FROM "AgentRun"
     WHERE "status" IN ('PLANNING', 'RUNNING', 'SUMMARIZING')
       AND ("heartbeatAt" IS NULL OR "heartbeatAt" <= ?)`
  ).all(staleBefore);
  const recovered = [];
  for (const run of staleRuns) {
    const changed = db.transaction(() => {
      const result = db.prepare(
        `UPDATE "AgentRun" SET "status" = 'QUEUED', "workerId" = NULL, "heartbeatAt" = NULL, "updatedAt" = ?
         WHERE "id" = ? AND "status" IN ('PLANNING', 'RUNNING', 'SUMMARIZING')
           AND ("heartbeatAt" IS NULL OR "heartbeatAt" <= ?)`
      ).run(timestamp, run.id, staleBefore);
      if (result.changes !== 1) return false;
      db.prepare(
        `UPDATE "AgentTask" SET "status" = 'PENDING', "startedAt" = NULL,
         "completedAt" = NULL, "updatedAt" = ? WHERE "runId" = ? AND "status" = 'RUNNING'`
      ).run(timestamp, run.id);
      db.prepare(
        `UPDATE "AgentTask" SET "status" = 'SUBMITTED', "updatedAt" = ?
         WHERE "runId" = ? AND "status" = 'REVIEWING'`
      ).run(timestamp, run.id);
      db.prepare(
        `UPDATE "AgentSession" SET "status" = 'IDLE', "currentTaskId" = NULL, "updatedAt" = ?
         WHERE "currentTaskId" IN (SELECT "id" FROM "AgentTask" WHERE "runId" = ?)`
      ).run(timestamp, run.id);
      return true;
    }).immediate();
    if (changed) recovered.push(run);
  }
  return recovered;
}

export function recoverInterruptedDiscussions(db, timestamp = new Date().toISOString()) {
  const queued = db.prepare(
    `UPDATE "SpaceDiscussion" SET "status" = 'QUEUED', "updatedAt" = ? WHERE "status" = 'RUNNING'`
  ).run(timestamp).changes;
  const cancelled = db.prepare(
    `UPDATE "SpaceDiscussion" SET "status" = 'CANCELLED', "completedAt" = ?, "updatedAt" = ?
     WHERE "status" = 'CANCEL_REQUESTED'`
  ).run(timestamp, timestamp).changes;
  return { queued, cancelled };
}
