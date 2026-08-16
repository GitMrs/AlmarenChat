import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const TERMINAL_STATUSES = new Set([
  'COMPLETED',
  'PARTIAL',
  'FAILED_VALIDATION',
  'FAILED',
  'BLOCKED',
  'CANCELLED',
]);
const FAILURE_STATUSES = new Set(['PARTIAL', 'FAILED_VALIDATION', 'FAILED', 'BLOCKED']);

function numberOption(value, label, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${label} 必须是 1 到 ${maximum} 之间的整数`);
  }
  return parsed;
}

export function parseReportArgs(argv) {
  const options = { days: 7, limit: 10, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') options.json = true;
    else if (argument === '--days') options.days = numberOption(argv[++index], '--days', 3650);
    else if (argument.startsWith('--days=')) options.days = numberOption(argument.slice(7), '--days', 3650);
    else if (argument === '--limit') options.limit = numberOption(argv[++index], '--limit', 100);
    else if (argument.startsWith('--limit=')) options.limit = numberOption(argument.slice(8), '--limit', 100);
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`未知参数：${argument}`);
  }
  return options;
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

function average(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function durationMs(startedAt, completedAt) {
  const start = Date.parse(startedAt || '');
  const end = Date.parse(completedAt || '');
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

function acceptanceFrom(events) {
  const acceptance = [...events].reverse().find((event) => event.type === 'RUN_ACCEPTANCE_COMPLETED');
  return acceptance ? parseJson(acceptance.payload, null) : null;
}

export function classifyFailure(run, events, outbox) {
  const eventTypes = new Set(events.map((event) => event.type));
  if (outbox && outbox.status !== 'DELIVERED') return '投递';
  const workspaceFailure = [...eventTypes].some((type) => [
    'ARTIFACT_MANIFEST_FAILED',
    'WORKSPACE_APPLICATION_RECOVERY_FAILED',
    'WORKSPACE_STAGING_CLEANUP_FAILED',
  ].includes(type)) || /工作区|产物检查|文件检查/.test(String(run.error || ''));
  if (workspaceFailure) return '工作区';
  const acceptance = acceptanceFrom(events);
  if (run.status === 'FAILED_VALIDATION' || acceptance?.accepted === false) return '验收';
  if (eventTypes.has('TASK_STARTED')) return '执行';
  return '规划';
}

function rowsByRun(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const values = grouped.get(row.runId) || [];
    values.push(row);
    grouped.set(row.runId, values);
  }
  return grouped;
}

function assertSchema(db) {
  for (const table of ['AgentRun', 'AgentTask', 'AgentRunEvent', 'AgentRunOutbox', 'Space', 'SpaceMessage']) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) {
      throw new Error(`数据库缺少 ${table}，请先完成 Agent Runtime 数据库升级`);
    }
  }
}

export function buildRuntimeReport(db, { days = 7, limit = 10, now = new Date() } = {}) {
  assertSchema(db);
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const runFilter = `run."runtimeVersion" = 3 AND datetime(run."createdAt") >= datetime(?)`;
  const runs = db.prepare(
    `SELECT run.*, space."name" AS "spaceName"
     FROM "AgentRun" run
     LEFT JOIN "Space" space ON space."id" = run."spaceId"
     WHERE ${runFilter}
     ORDER BY datetime(run."createdAt") DESC`
  ).all(cutoff);
  const tasks = db.prepare(
    `SELECT task."runId", COUNT(*) AS "taskCount", COALESCE(MAX(task."attempt"), 0) AS "maxAttempt"
     FROM "AgentTask" task JOIN "AgentRun" run ON run."id" = task."runId"
     WHERE ${runFilter} GROUP BY task."runId"`
  ).all(cutoff);
  const events = db.prepare(
    `SELECT event."runId", event."type", event."payload", event."message", event."sequence"
     FROM "AgentRunEvent" event JOIN "AgentRun" run ON run."id" = event."runId"
     WHERE ${runFilter} ORDER BY event."runId", event."sequence"`
  ).all(cutoff);
  const outboxes = db.prepare(
    `SELECT outbox."runId", outbox."status", outbox."attempts", outbox."lastError", outbox."deliveredAt"
     FROM "AgentRunOutbox" outbox JOIN "AgentRun" run ON run."id" = outbox."runId"
     WHERE ${runFilter}`
  ).all(cutoff);
  const completionMessages = db.prepare(
    `SELECT run."id" AS "runId", COUNT(message."id") AS "messageCount"
     FROM "AgentRun" run
     LEFT JOIN "SpaceMessage" message ON message."sourceKey" = run."completionId"
     WHERE ${runFilter} GROUP BY run."id"`
  ).all(cutoff);

  const tasksByRun = new Map(tasks.map((row) => [row.runId, row]));
  const eventsByRun = rowsByRun(events);
  const outboxByRun = new Map(outboxes.map((row) => [row.runId, row]));
  const messagesByRun = new Map(completionMessages.map((row) => [row.runId, Number(row.messageCount)]));
  const statuses = {};
  const failureStages = {};
  const failures = [];
  const deliveryIssues = [];
  let revisionCount = 0;
  let replanCount = 0;
  let coveredRequirements = 0;
  let requirementCount = 0;

  for (const run of runs) {
    statuses[run.status] = (statuses[run.status] || 0) + 1;
    const runEvents = eventsByRun.get(run.id) || [];
    revisionCount += runEvents.filter((event) => event.type === 'TASK_REVISION_REQUIRED').length;
    replanCount += runEvents.filter((event) => event.type === 'TASK_DISPATCH_REJECTED').length;
    const acceptance = acceptanceFrom(runEvents);
    coveredRequirements += Number(acceptance?.evidence?.coveredRequirements || 0);
    requirementCount += Number(acceptance?.evidence?.requirementCount || 0);

    const outbox = outboxByRun.get(run.id);
    const messageCount = messagesByRun.get(run.id) || 0;
    if (TERMINAL_STATUSES.has(run.status) && run.completionId
      && (outbox?.status !== 'DELIVERED' || messageCount !== 1)) {
      deliveryIssues.push({
        runId: run.id,
        status: run.status,
        outboxStatus: outbox?.status || 'MISSING',
        attempts: Number(outbox?.attempts || 0),
        messageCount,
      });
    }
    if (FAILURE_STATUSES.has(run.status)) {
      const stage = classifyFailure(run, runEvents, outbox);
      failureStages[stage] = (failureStages[stage] || 0) + 1;
      failures.push({
        runId: run.id,
        spaceName: run.spaceName || run.spaceId,
        status: run.status,
        stage,
        error: String(run.error || run.result || '').replace(/\s+/g, ' ').slice(0, 180),
        createdAt: run.createdAt,
      });
    }
  }

  const terminalRuns = runs.filter((run) => TERMINAL_STATUSES.has(run.status));
  const evaluatedRuns = terminalRuns.filter((run) => run.status !== 'CANCELLED');
  const completedRuns = runs.filter((run) => run.status === 'COMPLETED');
  const onePassRuns = completedRuns.filter((run) => {
    const runEvents = eventsByRun.get(run.id) || [];
    const task = tasksByRun.get(run.id);
    return Number(task?.maxAttempt || 0) <= 1
      && !runEvents.some((event) => ['TASK_REVISION_REQUIRED', 'TASK_DISPATCH_REJECTED'].includes(event.type));
  });
  const durations = terminalRuns.map((run) => durationMs(run.startedAt, run.completedAt)).filter((value) => value !== null);

  return {
    generatedAt: now.toISOString(),
    cutoff,
    days,
    sample: {
      all: runs.length,
      active: runs.length - terminalRuns.length,
      terminal: terminalRuns.length,
      completed: completedRuns.length,
      cancelled: statuses.CANCELLED || 0,
    },
    rates: {
      success: evaluatedRuns.length ? completedRuns.length / evaluatedRuns.length : null,
      onePass: completedRuns.length ? onePassRuns.length / completedRuns.length : null,
      goalCoverage: requirementCount ? coveredRequirements / requirementCount : null,
    },
    totals: { revisionCount, replanCount, coveredRequirements, requirementCount },
    averages: {
      modelRequests: average(runs.map((run) => Number(run.modelRequestCount || 0))),
      taskCount: average(runs.map((run) => Number(tasksByRun.get(run.id)?.taskCount || 0))),
      durationMs: average(durations),
    },
    statuses,
    failureStages,
    deliveryIssues: deliveryIssues.slice(0, limit),
    failures: failures.slice(0, limit),
  };
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function optionalPercent(value) {
  return value === null ? '暂无数据' : percent(value);
}

function decimal(value) {
  return Number(value || 0).toFixed(1);
}

function elapsed(milliseconds) {
  if (!milliseconds) return '0 秒';
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${seconds % 60} 秒`;
}

function distribution(values) {
  const entries = Object.entries(values).sort((left, right) => right[1] - left[1]);
  return entries.length ? entries.map(([name, count]) => `${name} ${count}`).join('，') : '无';
}

export function renderRuntimeReport(report) {
  const lines = [
    'V3 运行质量报告',
    `范围：最近 ${report.days} 天（自 ${report.cutoff} 起）`,
    '',
    `样本：${report.sample.all} 条，终态 ${report.sample.terminal}，运行中 ${report.sample.active}，取消 ${report.sample.cancelled}`,
    `成功率：${optionalPercent(report.rates.success)}（取消任务不计入分母）`,
    `一次完成率：${optionalPercent(report.rates.onePass)}（无返工、无退回重规划）`,
    `目标覆盖率：${optionalPercent(report.rates.goalCoverage)}${report.totals.requirementCount ? `（${report.totals.coveredRequirements}/${report.totals.requirementCount}）` : ''}`,
    `平均模型请求：${decimal(report.averages.modelRequests)} 次`,
    `平均任务数：${decimal(report.averages.taskCount)} 个`,
    `平均总耗时：${elapsed(report.averages.durationMs)}`,
    `返工：${report.totals.revisionCount} 次，退回重规划：${report.totals.replanCount} 次`,
    `状态分布：${distribution(report.statuses)}`,
    `失败阶段：${distribution(report.failureStages)}`,
    `完成消息投递异常：${report.deliveryIssues.length} 条`,
  ];
  if (report.failures.length > 0) {
    lines.push('', '最近失败：');
    for (const failure of report.failures) {
      lines.push(`- ${failure.runId} | ${failure.status} | ${failure.stage} | ${failure.spaceName}${failure.error ? ` | ${failure.error}` : ''}`);
    }
  }
  if (report.deliveryIssues.length > 0) {
    lines.push('', '投递异常：');
    for (const issue of report.deliveryIssues) {
      lines.push(`- ${issue.runId} | outbox=${issue.outboxStatus} | attempts=${issue.attempts} | messages=${issue.messageCount}`);
    }
  }
  return lines.join('\n');
}

function resolveDatabasePath() {
  const url = (process.env.DATABASE_URL || 'file:./dev.db').replace(/^["']|["']$/g, '');
  if (!url.startsWith('file:')) throw new Error('V3 报告当前只支持 SQLite DATABASE_URL');
  return path.resolve(process.cwd(), url.slice('file:'.length));
}

function usage() {
  return '用法：yarn v3:report [--days 7] [--limit 10] [--json]';
}

export function main(argv = process.argv.slice(2)) {
  const options = parseReportArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  const db = new Database(resolveDatabasePath(), { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  try {
    const report = buildRuntimeReport(db, options);
    console.log(options.json ? JSON.stringify(report, null, 2) : renderRuntimeReport(report));
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`V3 报告生成失败：${error instanceof Error ? error.message : String(error)}`);
    console.error(usage());
    process.exitCode = 1;
  }
}
