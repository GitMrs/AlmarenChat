import { randomUUID } from 'node:crypto';
import { agentMemoryContext } from '../../lib/agent-memory-policy.mjs';

function cleanText(value, limit) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function loadAgentMemoryContextSync(db, { userId, agentId, query }) {
  if (!userId || !agentId) return '';
  const agent = db.prepare(
    `SELECT 1 FROM "Agent" WHERE "id" = ? AND "agentType" = 'EMPLOYEE' LIMIT 1`
  ).get(agentId);
  if (!agent) return '';
  const rules = db.prepare(
    `SELECT "category", "title", "instruction", "status", "evidenceCount", "updatedAt"
     FROM "AgentMemoryRule"
     WHERE "userId" = ? AND "agentId" = ? AND "status" = 'ACTIVE'
     ORDER BY "updatedAt" DESC LIMIT 60`
  ).all(userId, agentId);
  return agentMemoryContext({ rules, query });
}

export function recordAcceptedAgentExperiences(db, { run, tasks, accepted, timestamp }) {
  const isEmployee = db.prepare(
    `SELECT 1 FROM "Agent" WHERE "id" = ? AND "agentType" = 'EMPLOYEE' LIMIT 1`
  );
  const statement = db.prepare(
    `INSERT INTO "AgentExperience"
      ("id", "userId", "agentId", "spaceId", "runId", "taskId", "title", "summary", "outcome", "tags", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT("userId", "agentId", "taskId") DO UPDATE SET
       "spaceId" = excluded."spaceId", "runId" = excluded."runId", "title" = excluded."title",
       "summary" = excluded."summary", "outcome" = excluded."outcome", "tags" = excluded."tags",
       "updatedAt" = excluded."updatedAt"`
  );
  for (const task of tasks) {
    if (!task?.agentId || !isEmployee.get(task.agentId) || !cleanText(task.result, 1)) continue;
    statement.run(
      randomUUID(),
      run.userId,
      task.agentId,
      run.spaceId,
      run.id,
      task.id,
      cleanText(task.title, 160) || '未命名任务',
      cleanText(task.result, 2_000),
      accepted && task.status === 'COMPLETED' ? 'ACCEPTED' : 'NEEDS_IMPROVEMENT',
      JSON.stringify([task.mode, task.skillId].filter(Boolean)),
      timestamp,
      timestamp
    );
  }
}
