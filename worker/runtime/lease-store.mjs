export function claimNextRun(db, workerId, timestamp = new Date().toISOString()) {
  return db.transaction(() => {
    const run = db.prepare(
      `SELECT * FROM "AgentRun" WHERE "status" = 'QUEUED' ORDER BY "createdAt" ASC LIMIT 1`
    ).get();
    if (!run) return null;
    const changed = db.prepare(
      `UPDATE "AgentRun" SET "status" = 'PLANNING', "workerId" = ?, "heartbeatAt" = ?,
       "startedAt" = COALESCE("startedAt", ?), "updatedAt" = ?
       WHERE "id" = ? AND "status" = 'QUEUED'`
    ).run(workerId, timestamp, timestamp, timestamp, run.id);
    return changed.changes === 1
      ? { ...run, status: 'PLANNING', workerId, heartbeatAt: timestamp, startedAt: run.startedAt || timestamp }
      : null;
  }).immediate();
}

export function heartbeatRunLease(db, runId, workerId, timestamp = new Date().toISOString()) {
  return db.prepare(
    `UPDATE "AgentRun" SET "heartbeatAt" = ?, "updatedAt" = ?
     WHERE "id" = ? AND "workerId" = ? AND "status" IN ('PLANNING', 'RUNNING', 'SUMMARIZING')`
  ).run(timestamp, timestamp, runId, workerId).changes === 1;
}

export function releaseRunLease(db, runId, workerId) {
  return db.prepare(
    `UPDATE "AgentRun" SET "workerId" = NULL, "heartbeatAt" = NULL
     WHERE "id" = ? AND "workerId" = ? AND "status" NOT IN ('PLANNING', 'RUNNING', 'SUMMARIZING')`
  ).run(runId, workerId).changes === 1;
}

export function claimNextDiscussion(db, timestamp = new Date().toISOString()) {
  return db.transaction(() => {
    const discussion = db.prepare(
      `SELECT * FROM "SpaceDiscussion" WHERE "status" = 'QUEUED' ORDER BY "createdAt" ASC LIMIT 1`
    ).get();
    if (!discussion) return null;
    const changed = db.prepare(
      `UPDATE "SpaceDiscussion" SET "status" = 'RUNNING',
       "startedAt" = COALESCE("startedAt", ?), "updatedAt" = ?
       WHERE "id" = ? AND "status" = 'QUEUED'`
    ).run(timestamp, timestamp, discussion.id);
    return changed.changes === 1
      ? { ...discussion, status: 'RUNNING', startedAt: discussion.startedAt || timestamp }
      : null;
  }).immediate();
}
