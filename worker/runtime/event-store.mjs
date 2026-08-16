import { randomUUID } from 'node:crypto';

function json(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

export function appendRunEvent(db, event, timestamp = new Date().toISOString()) {
  if (!event?.runId || !event?.type) throw new Error('运行事件缺少 runId 或 type');
  return db.transaction(() => {
    if (event.idempotencyKey) {
      const existing = db.prepare(
        'SELECT * FROM "AgentRunEvent" WHERE "idempotencyKey" = ?'
      ).get(event.idempotencyKey);
      if (existing) return existing;
    }

    const advanced = db.prepare(
      `UPDATE "AgentRun"
       SET "eventSequence" = "eventSequence" + 1, "updatedAt" = ?
       WHERE "id" = ?`
    ).run(timestamp, event.runId);
    if (advanced.changes !== 1) throw new Error(`运行不存在：${event.runId}`);
    const sequence = db.prepare(
      'SELECT "eventSequence" FROM "AgentRun" WHERE "id" = ?'
    ).get(event.runId).eventSequence;
    const id = event.id || randomUUID();
    db.prepare(
      `INSERT INTO "AgentRunEvent"
        ("id", "runId", "type", "message", "payload", "idempotencyKey",
         "sequence", "taskId", "agentId", "attempt", "actor", "createdAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      event.runId,
      event.type,
      String(event.message || ''),
      json(event.payload),
      event.idempotencyKey || null,
      sequence,
      event.taskId || null,
      event.agentId || null,
      Number.isInteger(event.attempt) ? event.attempt : null,
      event.actor || null,
      timestamp
    );
    return db.prepare('SELECT * FROM "AgentRunEvent" WHERE "id" = ?').get(id);
  })();
}

export function listRunEventsAfter(db, runId, afterSequence = 0, limit = 200) {
  return db.prepare(
    `SELECT * FROM "AgentRunEvent"
     WHERE "runId" = ? AND "sequence" > ?
     ORDER BY "sequence" ASC LIMIT ?`
  ).all(runId, Math.max(0, Number(afterSequence) || 0), Math.min(500, Math.max(1, Number(limit) || 200)));
}
