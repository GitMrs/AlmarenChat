import { memorySearchTerms, isBroadMemoryRecall } from '../../lib/memory/memory-recall.mjs';
import { activeGrowthEvents } from '../../lib/agents/growth/cognition.mjs';
import { randomUUID } from 'node:crypto';
import { agentMemoryContext } from '../../lib/agents/memory/agent-memory-policy.mjs';
import { personalMemoryContext, buildSpaceExperience } from '../../lib/agents/memory/agent-personal-memory.mjs';

function cleanText(value, limit) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function loadAgentMemoryContextSync(db, { userId, agentId, query, spaceId = null }) {
  if (!userId || !agentId) return '';
  const agent = db.prepare(
    `SELECT "agentType" FROM "Agent" WHERE "id" = ? LIMIT 1`
  ).get(agentId);
  const candidateFilter = fields => {
    const terms = isBroadMemoryRecall(query) ? [] : memorySearchTerms(query).slice(0, 48);
    return {
      sql: terms.length ? ` AND (${terms.flatMap(() => fields.map(field => `instr(lower("${field}"), lower(?)) > 0`)).join(' OR ')})` : '',
      params: terms.flatMap(term => fields.map(() => term)),
    };
  };
  const factsFilter = candidateFilter(['category', 'content']);
  const ruleFilter = candidateFilter(['title', 'instruction']);
  const experienceFilter = candidateFilter(['title', 'summary']);
  const memories = db.prepare(
    `SELECT "category", "content" FROM "AgentMemoryItem" WHERE "userId" = ? AND "agentId" = ? AND "status" = 'ACTIVE' AND "category" != 'skill' ${factsFilter.sql} ORDER BY "updatedAt" DESC LIMIT 60`
  ).all(userId, agentId, ...factsFilter.params);
  const rules = agent?.agentType === 'EMPLOYEE' ? db.prepare(
    `SELECT "category", "title", "instruction", "status", "evidenceCount", "updatedAt"
     FROM "AgentMemoryRule"
     WHERE "userId" = ? AND "agentId" = ? AND "status" = 'ACTIVE'
     ${ruleFilter.sql} ORDER BY "updatedAt" DESC LIMIT 60`
  ).all(userId, agentId, ...ruleFilter.params) : [];
  const experiences = db.prepare(
    `SELECT "id", "title", "summary", "outcome", "spaceId", "sourceType", "createdAt", "tags"
     FROM "AgentExperience"
     WHERE "userId" = ? AND "agentId" = ? AND "outcome" = 'ACCEPTED' AND "status" = 'ACTIVE'
       AND ("spaceId" IS NULL OR "spaceId" = ?)
     ${experienceFilter.sql} ORDER BY "updatedAt" DESC LIMIT 120`
  ).all(userId, agentId, spaceId, ...experienceFilter.params).map(item => {
    try { return { ...item, tags: typeof item.tags === 'string' ? JSON.parse(item.tags) : item.tags }; }
    catch { return { ...item, tags: [] }; }
  });
  const growth = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'AgentGrowthEvent'`).get()
    ? activeGrowthEvents(db.prepare(`SELECT * FROM "AgentGrowthEvent" WHERE "userId" = ? AND "agentId" = ? AND ("scope" = 'PERSONAL' OR ("scope" = 'SPACE' AND "spaceId" = ?)) ORDER BY "createdAt" DESC`).all(userId, agentId, spaceId).map(e => ({ ...e, payload: JSON.parse(e.payload) })))
      .filter(e => ['BELIEF', 'REVISION', 'REFLECTION'].includes(e.type) && (e.payload?.beliefKey || e.payload?.evidence))
      .slice(0, 8).map(e => `- [判断 ID:${e.id}] ${e.payload.content}；后续行为：${e.payload.behaviorChange || '依据原记录的适用条件'}`).join('\n')
    : '';
  return [growth ? `当前有效判断（有适用条件，不是用户约定）：\n${growth}` : '', personalMemoryContext(memories, query), agentMemoryContext({ rules, experiences, query })].filter(Boolean).join('\n\n');
}

export function recordAcceptedAgentExperiences(db, { run, tasks, accepted, timestamp }) {
  const statement = db.prepare(
    `INSERT INTO "AgentExperience"
      ("id", "userId", "agentId", "spaceId", "runId", "taskId", "title", "summary", "outcome", "tags", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT("userId", "agentId", "taskId") DO UPDATE SET
       "spaceId" = excluded."spaceId", "runId" = excluded."runId", "title" = excluded."title",
       "summary" = CASE WHEN "AgentExperience"."edited" THEN "AgentExperience"."summary" ELSE excluded."summary" END, "outcome" = excluded."outcome", "tags" = excluded."tags",
       "updatedAt" = excluded."updatedAt"`
  );
  for (const task of tasks) {
    if (!task?.agentId || task.agentId === 'space-coordinator' || !cleanText(task.result, 1)) continue;
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

export function recordSpaceAgentExperiences(db, { userId, spaceId, sourceType, sourceId, topic, summary, entries, timestamp }) {
  const statement = db.prepare(
    `INSERT INTO "AgentExperience" ("id", "userId", "agentId", "spaceId", "taskId", "title", "summary", "outcome", "sourceType", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ACCEPTED', ?, ?, ?)
     ON CONFLICT("userId", "agentId", "taskId") DO UPDATE SET "title" = excluded."title", "summary" = CASE WHEN "AgentExperience"."edited" THEN "AgentExperience"."summary" ELSE excluded."summary" END, "updatedAt" = excluded."updatedAt"`
  );
  for (const agentId of new Set(entries.map(entry => entry.agentId).filter(id => id && id !== 'space-coordinator'))) {
    const episode = buildSpaceExperience({ spaceId, sourceType, sourceId, topic, summary, entries, agentId });
    if (!episode) continue;
    statement.run(randomUUID(), userId, agentId, spaceId, episode.taskId, episode.title, episode.summary, sourceType, timestamp, timestamp);
  }
}
