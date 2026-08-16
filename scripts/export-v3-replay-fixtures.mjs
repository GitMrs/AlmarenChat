import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SCENARIOS = [
  { id: '01', file: '01-direct-analysis.json', space: 'V3-01-直接分析', completedIndex: 0 },
  { id: '02', file: '02-page-create.json', space: 'V3-02-页面创建和修改', completedIndex: 0 },
  { id: '03', file: '03-page-update.json', space: 'V3-02-页面创建和修改', completedIndex: 1 },
  { id: '04', file: '04-multi-agent.json', space: 'V3-04-多成员协作', completedIndex: 0 },
  { id: '05', file: '05-dispatch-approval.json', space: 'V3-05-派发确认', completedIndex: -1 },
  { id: '06', file: '06-replan-after-rejection.json', space: 'V3-06-退回重规划', completedIndex: 0 },
  { id: '07', file: '07-revised-dispatch.json', space: 'V3-07-调整派发', completedIndex: 0 },
];

const EXPECTATIONS = {
  '01': { taskCount: 1, executedTaskCount: 1, taskAgents: ['professional-frontend'], taskModes: ['executor'], artifactPaths: [], webEventCount: 0 },
  '02': { taskCount: 1, executedTaskCount: 1, taskAgents: ['professional-frontend'], taskModes: ['executor'], artifactPaths: ['index.html'], webEventCount: 0 },
  '03': { taskCount: 1, executedTaskCount: 1, taskAgents: ['professional-frontend'], taskModes: ['executor'], artifactPaths: ['index.html'], artifactChanges: ['MODIFIED'], webEventCount: 0 },
  '04': { taskCount: 2, executedTaskCount: 2, taskAgents: ['professional-product', 'professional-frontend'], taskModes: ['advisor', 'executor'], artifactPaths: ['index.html'], webEventCount: 0 },
  '05': { taskCount: 1, executedTaskCount: 1, taskAgents: ['professional-frontend'], taskModes: ['executor'], artifactPaths: ['index.html'], dispatchApprovalCount: 1, webEventCount: 0 },
  '06': { taskCount: 3, executedTaskCount: 2, taskAgents: ['professional-product', 'professional-frontend'], taskModes: ['advisor', 'executor'], artifactPaths: ['docs/ticket-list-product-rules.md', 'index.html'], dispatchApprovalCount: 2, rejectedProposalCount: 1, webEventCount: 0 },
  '07': { taskCount: 1, executedTaskCount: 1, taskAgents: ['professional-frontend'], taskModes: ['executor'], artifactPaths: ['index.html'], dispatchApprovalCount: 1, revisedDispatchCount: 1, webEventCount: 0 },
};

function parseArgs(argv) {
  const options = {
    database: null,
    output: path.join(projectRoot, 'test-fixtures', 'v3'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--database') options.database = argv[++index];
    else if (value.startsWith('--database=')) options.database = value.slice('--database='.length);
    else if (value === '--output') options.output = argv[++index];
    else if (value.startsWith('--output=')) options.output = value.slice('--output='.length);
    else throw new Error(`未知参数：${value}`);
  }
  return options;
}

function databasePath(explicitPath) {
  if (explicitPath) return path.resolve(projectRoot, explicitPath);
  const url = (process.env.DATABASE_URL || 'file:./dev.db').replace(/^['"]|['"]$/g, '');
  if (!url.startsWith('file:')) throw new Error('夹具导出目前仅支持 SQLite DATABASE_URL');
  return path.resolve(projectRoot, url.slice('file:'.length));
}

function json(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

function normalizer(replacements) {
  const opaqueIds = new Map();
  let nextOpaqueId = 1;
  return function normalize(value) {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
    }
    if (typeof value !== 'string') return value;
    let result = value;
    for (const [source, target] of replacements) result = result.split(source).join(target);
    result = result.replace(/[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/gi, (id) => {
      if (!opaqueIds.has(id)) opaqueIds.set(id, `opaque-id-${nextOpaqueId++}`);
      return opaqueIds.get(id);
    });
    result = result.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<timestamp>');
    result = result.replaceAll(projectRoot, '<project-root>');
    return result;
  };
}

function selectRun(db, scenario) {
  const runs = db.prepare(
    `SELECT run.*, space."name" AS "spaceName", space."executionMode"
     FROM "AgentRun" run JOIN "Space" space ON space."id" = run."spaceId"
     WHERE space."name" = ? AND run."runtimeVersion" = 3 AND run."status" = 'COMPLETED'
     ORDER BY run."createdAt" ASC`
  ).all(scenario.space);
  const index = scenario.completedIndex < 0 ? runs.length - 1 : scenario.completedIndex;
  if (!runs[index]) throw new Error(`场景 ${scenario.id} 缺少可导出的成功 Run：${scenario.space}`);
  return runs[index];
}

function exportScenario(db, scenario) {
  const run = selectRun(db, scenario);
  const tasks = db.prepare('SELECT * FROM "AgentTask" WHERE "runId" = ? ORDER BY "sortOrder", "createdAt"').all(run.id);
  const events = db.prepare('SELECT * FROM "AgentRunEvent" WHERE "runId" = ? ORDER BY "sequence"').all(run.id);
  const manifests = db.prepare('SELECT * FROM "AgentArtifactManifest" WHERE "runId" = ? ORDER BY "createdAt"').all(run.id);
  const turns = db.prepare('SELECT * FROM "AgentCoordinatorTurn" WHERE "runId" = ? ORDER BY "createdAt"').all(run.id);
  const outbox = db.prepare('SELECT * FROM "AgentRunOutbox" WHERE "runId" = ?').get(run.id);
  const taskRefs = new Map(tasks.map((task, index) => [task.id, `task-${index + 1}`]));
  const replacements = [
    ...taskRefs.entries(),
    [run.id, 'run'],
    [run.spaceId, 'space'],
    ...turns.map((turn, index) => [turn.id, `coordinator-turn-${index + 1}`]),
  ].sort((left, right) => right[0].length - left[0].length);
  const normalize = normalizer(replacements);
  const userMessage = db.prepare(
    `SELECT "content" FROM "SpaceMessage"
     WHERE "spaceId" = ? AND "role" = 'user' AND "createdAt" <= ?
     ORDER BY "createdAt" DESC LIMIT 1`
  ).get(run.spaceId, run.createdAt)?.content || '';
  const members = db.prepare(
    'SELECT "agentId", "roleName", "sortOrder" FROM "SpaceMember" WHERE "spaceId" = ? ORDER BY "sortOrder", "createdAt"'
  ).all(run.spaceId);
  const state = json(run.coordinatorState, {});
  const completionMessageCount = outbox
    ? db.prepare('SELECT COUNT(*) AS "count" FROM "SpaceMessage" WHERE "sourceKey" = ?').get(outbox.idempotencyKey).count
    : 0;

  return {
    schemaVersion: 1,
    scenario: scenario.id,
    name: scenario.space,
    source: {
      executionMode: run.executionMode,
      runtimeVersion: run.runtimeVersion,
      sourceAttempt: run.attempt,
    },
    input: {
      userMessage: normalize(userMessage),
      authorizedObjective: normalize(run.input),
      authorization: normalize(state.authorization || null),
    },
    team: members.map((member) => ({
      agentId: member.agentId,
      roleName: member.roleName,
      sortOrder: member.sortOrder,
    })),
    run: {
      status: run.status,
      modelRequestCount: run.modelRequestCount,
      result: normalize(run.result || ''),
      error: normalize(run.error),
      completion: outbox ? {
        status: outbox.status,
        attempts: outbox.attempts,
        messageDelivered: completionMessageCount === 1,
      } : null,
    },
    tasks: tasks.map((task) => ({
      ref: taskRefs.get(task.id),
      agentId: task.agentId,
      agentName: task.agentName,
      title: normalize(task.title),
      instruction: normalize(task.instruction),
      acceptanceCriteria: normalize(task.acceptanceCriteria),
      origin: task.origin,
      mode: task.mode,
      status: task.status,
      sortOrder: task.sortOrder,
      attempt: task.attempt,
      modelRequestCount: task.modelRequestCount,
      reviewDecision: task.reviewDecision,
      result: normalize(task.result || ''),
      lifecycle: {
        proposed: Boolean(task.proposedAt),
        approved: Boolean(task.approvedAt),
        started: Boolean(task.startedAt),
        submitted: Boolean(task.submittedAt),
        reviewed: Boolean(task.reviewedAt),
        completed: Boolean(task.completedAt),
      },
    })),
    coordinatorTurns: turns.map((turn, index) => ({
      ref: `coordinator-turn-${index + 1}`,
      status: turn.status,
      modelRequestCount: turn.modelRequestCount,
      action: normalize(json(turn.action)),
      error: normalize(turn.error),
    })),
    events: events.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      actor: event.actor,
      taskRef: event.taskId ? taskRefs.get(event.taskId) || normalize(event.taskId) : null,
      agentId: event.agentId,
      message: normalize(event.message),
      payload: normalize(json(event.payload)),
    })),
    manifests: manifests.map((manifest) => ({
      taskRef: taskRefs.get(manifest.taskId),
      attempt: manifest.attempt,
      status: manifest.status,
      entries: normalize(json(manifest.entries, [])),
      validation: normalize(json(manifest.validation)),
    })),
    expectations: {
      terminalStatus: 'COMPLETED',
      completionMessageDelivered: true,
      ...EXPECTATIONS[scenario.id],
    },
  };
}

export async function exportV3ReplayFixtures({ database, output }) {
  const db = new Database(databasePath(database), { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  try {
    const fixtures = SCENARIOS.map((scenario) => [scenario.file, exportScenario(db, scenario)]);
    await mkdir(path.resolve(projectRoot, output), { recursive: true });
    for (const [fileName, fixture] of fixtures) {
      await writeFile(path.resolve(projectRoot, output, fileName), `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
    }
    return fixtures.map(([fileName]) => fileName);
  } finally {
    db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const files = await exportV3ReplayFixtures(options);
  console.log(`已导出 ${files.length} 个 V3 重放夹具：${files.join('、')}`);
}
