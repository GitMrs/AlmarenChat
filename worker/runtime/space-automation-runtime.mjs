import { randomUUID } from 'node:crypto';
import { automationAuthorization, nextScheduledAutomationRunAt } from '../../lib/space-automation-policy.mjs';
import { executeSpaceScriptSync } from '../../lib/space-script-runner.mjs';
import { commitSpacePendingHistory } from '../../lib/space-pending-history.mjs';

const ACTIVE_RUN_STATUSES = ['QUEUED', 'PLANNING', 'RUNNING', 'WAITING', 'WAITING_APPROVAL', 'SUMMARIZING', 'CANCEL_REQUESTED'];
const ACTIVE_RELAY_STATUSES = ['QUEUED', 'RUNNING', 'PAUSE_REQUESTED', 'WAITING_APPROVAL', 'PAUSED', 'CANCEL_REQUESTED'];

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

function automationExecutionInput(db, automation, prompt, scriptData = null) {
  const recentWorks = db.prepare(
    `SELECT "title", "objective", "status", "updatedAt"
     FROM "SpaceWork"
     WHERE "spaceId" = ? AND "kind" = ? AND "status" <> 'ARCHIVED'
     ORDER BY "updatedAt" DESC LIMIT 12`
  ).all(automation.spaceId, automation.templateId || 'general');
  const history = recentWorks.length > 0
    ? recentWorks.map((work, index) => `${index + 1}. ${String(work.title || '').slice(0, 120)}${work.objective ? `：${String(work.objective).slice(0, 240)}` : ''}`).join('\n')
    : '暂无已完成成果。';
  const scriptPrefix = scriptData
    ? `【前置脚本执行采集的数据 (${automation.scriptPath})】：\n${scriptData}\n\n`
    : '';
  return `${scriptPrefix}${prompt}\n\n自动化选题推进要求：\n- 读取空间共享策略和选题池，选择一个本次尚未完成的新主题。\n- 避免与下面最近成果的主题、标题和角度重复；如果选题池已使用完，明确说明并选择最接近但不同的角度。\n- 本次只创作一篇新成果，不要重复改写历史文章。\n最近成果记录：\n${history}`.slice(0, 12_000);
}

export function triggerNextDueAutomation(db, timestamp = new Date().toISOString(), options = {}) {
  const { projectRoot = process.cwd() } = options;
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
    const executionId = randomUUID();
    const mode = automation.executionMode || 'PROMPT';

    // 处理脚本执行（SCRIPT_ANALYSIS 或 SCRIPT_DIRECT）
    let scriptData = null;
    if (mode === 'SCRIPT_ANALYSIS' || mode === 'SCRIPT_DIRECT') {
      const scriptResult = executeSpaceScriptSync({
        projectRoot,
        userId: automation.userId,
        spaceId: automation.spaceId,
        scriptPath: automation.scriptPath,
      });

      if (!scriptResult.ok) {
        const errorDetail = scriptResult.timedOut
          ? '脚本执行超时'
          : (scriptResult.stderr || scriptResult.stdout || `脚本异常退出 (code: ${scriptResult.exitCode})`);
        const errMessage = `${mode === 'SCRIPT_DIRECT' ? '脚本' : '前置脚本'}执行失败：${errorDetail}`.slice(0, 500);

        db.prepare(
          `INSERT INTO "SpaceAutomationExecution"
           ("id", "automationId", "scheduledFor", "status", "runId", "error", "createdAt", "updatedAt")
           VALUES (?, ?, ?, 'FAILED', NULL, ?, ?, ?)`
        ).run(executionId, automation.id, scheduledFor, errMessage, timestamp, timestamp);

        db.prepare(
          `INSERT INTO "SpaceMessage" ("id", "spaceId", "role", "speakerAgentId", "content", "attachments", "sourceKey", "createdAt")
           VALUES (?, ?, 'assistant', 'space-coordinator', ?, ?, ?, ?)`
        ).run(
          randomUUID(),
          automation.spaceId,
          `自动化“${automation.name}”${errMessage}`,
          JSON.stringify([{ type: 'automation_error', automationId: automation.id, executionId, scheduledFor, error: errMessage }]),
          `automation-error:${executionId}`,
          timestamp
        );

        db.prepare(
          `UPDATE "SpaceAutomation"
           SET "nextRunAt" = ?, "lastRunAt" = ?, "lastRunId" = NULL, "lastError" = ?, "updatedAt" = ?
           WHERE "id" = ? AND "nextRunAt" = ?`
        ).run(nextRunAt, timestamp, errMessage, timestamp, automation.id, scheduledFor);

        return { automationId: automation.id, executionId, status: 'FAILED', reason: 'SCRIPT_ERROR', nextRunAt };
      }

      scriptData = scriptResult.stdout;

      // 如果是 SCRIPT_DIRECT，脚本执行成功即代表自动化完成，不启动 AI AgentRun
      if (mode === 'SCRIPT_DIRECT') {
        const title = workTitle(automation, timestamp);
        const workId = randomUUID();
        const contentOutput = scriptData.slice(0, 4000);

        db.prepare(
          `INSERT INTO "SpaceWork"
           ("id", "spaceId", "title", "kind", "status", "stage", "objective", "completedAt", "createdAt", "updatedAt")
           VALUES (?, ?, ?, ?, 'COMPLETED', 'delivery', ?, ?, ?, ?)`
        ).run(workId, automation.spaceId, title, automation.templateId || 'general', contentOutput, timestamp, timestamp, timestamp);

        db.prepare(
          `INSERT INTO "SpaceAutomationExecution"
           ("id", "automationId", "scheduledFor", "status", "runId", "createdAt", "updatedAt")
           VALUES (?, ?, ?, 'COMPLETED', NULL, ?, ?)`
        ).run(executionId, automation.id, scheduledFor, timestamp, timestamp);

        db.prepare(
          `INSERT INTO "SpaceMessage" ("id", "spaceId", "role", "speakerAgentId", "content", "attachments", "sourceKey", "createdAt")
           VALUES (?, ?, 'assistant', 'space-coordinator', ?, ?, ?, ?)`
        ).run(
          randomUUID(),
          automation.spaceId,
          `自动化“${automation.name}”直接脚本执行完成：\n\n\`\`\`\n${contentOutput}\n\`\`\``,
          JSON.stringify([{ type: 'automation_script_direct', automationId: automation.id, executionId, workId, scheduledFor }]),
          `automation-direct:${executionId}`,
          timestamp
        );

        db.prepare(
          `UPDATE "SpaceAutomation"
           SET "nextRunAt" = ?, "lastRunAt" = ?, "lastRunId" = NULL, "lastError" = NULL, "updatedAt" = ?
           WHERE "id" = ? AND "nextRunAt" = ?`
        ).run(nextRunAt, timestamp, timestamp, automation.id, scheduledFor);

        db.prepare('UPDATE "Space" SET "activeWorkId" = ?, "updatedAt" = ? WHERE "id" = ?').run(
          workId,
          timestamp,
          automation.spaceId
        );

        commitSpacePendingHistory({ projectRoot, userId: automation.userId, spaceId: automation.spaceId });

        return { automationId: automation.id, executionId, workId, status: 'COMPLETED', nextRunAt };
      }
    }

    // PROMPT 或 SCRIPT_ANALYSIS (脚本成功后执行 AI 分析)
    const runId = randomUUID();
    const snapshot = parseSnapshot(automation.templateSnapshot);
    const authorization = automationAuthorization(automation, snapshot);
    const prompt = String(automation.prompt || '').trim();
    const input = automationExecutionInput(db, automation, prompt, scriptData);
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
      mode === 'SCRIPT_ANALYSIS'
        ? `自动化“${automation.name}”前置脚本已采集数据，等待协调者分析推进`
        : `自动化“${automation.name}”已到期，等待协调者安排工作`,
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
      mode === 'SCRIPT_ANALYSIS'
        ? `自动化“${automation.name}”已成功获取脚本数据，进入智能分析创作流程。`
        : `自动化“${automation.name}”已开始执行。`,
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
