import { skillsForAgent } from '../../lib/agent-runtime/skill-registry.mjs';

const ACTIVE_TASK_STATUSES = new Set([
  'PROPOSED',
  'PENDING',
  'RUNNING',
  'WAITING',
  'WAITING_USER',
  'SUBMITTED',
  'REVIEWING',
]);

export function readCoordinatorState(db, runId) {
  const raw = db.prepare(
    `SELECT "coordinatorState" FROM "AgentRun" WHERE "id" = ?`
  ).get(runId)?.coordinatorState;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function loadCoordinatorDecisionContext(db, run, agents) {
  const existingTasks = db.prepare(
    `SELECT * FROM "AgentTask" WHERE "runId" = ? ORDER BY "sortOrder" ASC`
  ).all(run.id);
  const state = readCoordinatorState(db, run.id);
  const authorization = state.authorization || {
    objective: run.input,
    steps: [],
    deliverables: [],
    artifacts: [],
    capabilities: [],
    networkPolicy: 'forbidden',
    maxTasks: 8,
  };
  const maxTasks = Math.min(12, Math.max(1, Number(authorization.maxTasks || 8)));
  const sessions = new Map(db.prepare(
    `SELECT "agentId", "status", "currentTaskId" FROM "AgentSession" WHERE "spaceId" = ?`
  ).all(run.spaceId).map((session) => [session.agentId, session]));

  return {
    existingTasks,
    activeTasks: existingTasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status)),
    completedTasks: existingTasks.filter((task) => task.status === 'COMPLETED'),
    state,
    authorization,
    remainingTasks: Math.max(0, maxTasks - existingTasks.length),
    team: agents.map((agent) => {
      const session = sessions.get(agent.id);
      return {
        id: agent.id,
        name: agent.name,
        category: agent.category || '普通成员',
        description: agent.description || '',
        availableSkills: skillsForAgent(agent),
        status: session?.status || 'IDLE',
        currentTaskId: session?.currentTaskId || null,
      };
    }),
  };
}

export function loadCoordinatorAcceptanceEvidence(db, runId) {
  return {
    tasks: db.prepare(
      `SELECT * FROM "AgentTask" WHERE "runId" = ? ORDER BY "sortOrder" ASC`
    ).all(runId),
    manifests: db.prepare(
      `SELECT * FROM "AgentArtifactManifest" WHERE "runId" = ? ORDER BY "createdAt" ASC`
    ).all(runId),
    events: db.prepare(
      `SELECT "type", "message", "payload" FROM "AgentRunEvent" WHERE "runId" = ? ORDER BY "createdAt" ASC`
    ).all(runId),
  };
}
