import {
  normalizeOfficialDomains,
  normalizeSearchQueries,
  researchRequirements,
  searchWeb,
  wantsWebResearch,
} from '../../lib/agent-runtime/runtime-tools.mjs';
import { authorizationAllowsCapability } from '../../lib/agent-runtime-v3-policy.mjs';

function parseResearchPlan(content, fallbackQuery) {
  try {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return { queries: normalizeSearchQueries([fallbackQuery]), officialDomains: [] };
    }
    const parsed = JSON.parse(content.slice(start, end + 1));
    return {
      queries: normalizeSearchQueries(parsed.queries),
      officialDomains: normalizeOfficialDomains(parsed.officialDomains),
    };
  } catch {
    return { queries: normalizeSearchQueries([fallbackQuery]), officialDomains: [] };
  }
}

function remediationQuery(queries, audit) {
  const base = String(queries[0] || '').trim();
  if (!base) return '';
  const issues = (audit?.issues || []).join(' ');
  if (/日期|时间|时效/.test(issues)) return `${base} 官方 实况 更新时间`;
  if (/官方|权威|第一方/.test(issues)) return `${base} 官方`;
  return `${base} 官方 原始数据`;
}

export function createResearchRuntime({
  db,
  complete,
  addEvent,
  fakeMode = false,
  now = () => new Date().toISOString(),
  search = searchWeb,
}) {
  function taskNeedsResearchContext(task) {
    return wantsWebResearch(`${task.title}\n${task.instruction}`);
  }

  function restoreResearchAudit(runId, visited = new Set()) {
    if (!runId || visited.has(runId)) return null;
    visited.add(runId);
    const event = db.prepare(
      `SELECT "payload" FROM "AgentRunEvent" WHERE "runId" = ? AND "type" = 'WEB_SEARCH_COMPLETED' ORDER BY "createdAt" DESC LIMIT 1`
    ).get(runId);
    if (event?.payload) {
      try {
        return JSON.parse(event.payload).audit || null;
      } catch {
        return null;
      }
    }
    const run = db.prepare('SELECT "retryOfId" FROM "AgentRun" WHERE "id" = ?').get(runId);
    return run?.retryOfId ? restoreResearchAudit(run.retryOfId, visited) : null;
  }

  function restoreResearchResultAudits(runId) {
    const latestByTask = new Map();
    const visited = new Set();
    const restore = (currentRunId) => {
      if (!currentRunId || visited.has(currentRunId)) return;
      visited.add(currentRunId);
      const currentRun = db.prepare('SELECT "retryOfId" FROM "AgentRun" WHERE "id" = ?').get(currentRunId);
      if (currentRun?.retryOfId) restore(currentRun.retryOfId);
      const events = db.prepare(
        `SELECT "payload" FROM "AgentRunEvent" WHERE "runId" = ? AND "type" = 'RESEARCH_RESULT_AUDITED' ORDER BY "createdAt" ASC`
      ).all(currentRunId);
      const taskOrderById = new Map(
        db.prepare('SELECT "id", "sortOrder" FROM "AgentTask" WHERE "runId" = ?').all(currentRunId)
          .map((task) => [task.id, task.sortOrder])
      );
      for (const event of events) {
        try {
          const payload = JSON.parse(event.payload || '{}');
          const taskSortOrder = taskOrderById.get(payload.taskId);
          if (payload.taskId && payload.audit) {
            const key = taskSortOrder === undefined ? payload.taskId : `order:${taskSortOrder}`;
            latestByTask.set(key, { ...payload.audit, taskSortOrder });
          }
        } catch {
          // Malformed legacy audit events do not block recovery.
        }
      }
    };
    restore(runId);
    return [...latestByTask.values()];
  }

  function restoreResearchSources(runId, visited = new Set()) {
    if (!runId || visited.has(runId)) return [];
    visited.add(runId);
    const event = db.prepare(
      `SELECT "payload" FROM "AgentRunEvent" WHERE "runId" = ? AND "type" = 'WEB_SEARCH_COMPLETED' ORDER BY "createdAt" DESC LIMIT 1`
    ).get(runId);
    if (event?.payload) {
      try {
        const payload = JSON.parse(event.payload || '{}');
        return Array.isArray(payload.sources) ? payload.sources : [];
      } catch {
        return [];
      }
    }
    const run = db.prepare('SELECT "retryOfId" FROM "AgentRun" WHERE "id" = ?').get(runId);
    return run?.retryOfId ? restoreResearchSources(run.retryOfId, visited) : [];
  }

  function restoreResearchContext(runId, visited = new Set()) {
    if (!runId || visited.has(runId)) return '';
    visited.add(runId);
    const event = db.prepare(
      `SELECT "payload" FROM "AgentRunEvent" WHERE "runId" = ? AND "type" = 'WEB_SEARCH_COMPLETED' ORDER BY "createdAt" DESC LIMIT 1`
    ).get(runId);
    if (event?.payload) {
      try {
        return String(JSON.parse(event.payload).context || '');
      } catch {
        return '';
      }
    }
    const run = db.prepare('SELECT "retryOfId" FROM "AgentRun" WHERE "id" = ?').get(runId);
    return run?.retryOfId ? restoreResearchContext(run.retryOfId, visited) : '';
  }

  async function createResearchPlan(run, context, researchInput) {
    if (fakeMode) return { queries: normalizeSearchQueries([researchInput]), officialDomains: [] };
    const content = await complete(context.model, [
      {
        role: 'system',
        content:
          `当前绝对时间（UTC）是 ${now()}。为用户目标生成 1 到 2 个简短、具体、互补的联网检索关键词，并识别目标实体已知的官方网站域名。` +
          '时效性问题要把当前年份或明确日期写入至少一个查询，另一个查询优先定位官方公告、发布记录或原始数据。' +
          '只输出 JSON：{"queries":["关键词"],"officialDomains":["example.com"]}。' +
          '域名只能填写你确定属于目标实体的官方网站根域名，不要填写路径、搜索引擎、媒体、百科或不确定的域名；无法确定时返回空数组。' +
          '不要输出解释，不要包含隐私数据。',
      },
      { role: 'user', content: researchInput },
    ], {
      runId: run.id,
      onRetry: (error) => addEvent(run.id, 'MODEL_RETRYING', '联网检索规划的模型请求暂时失败，正在重试', {
        actor: 'research-planner',
        status: Number(error?.status || error?.statusCode || 0) || null,
        error: String(error?.message || error).slice(0, 500),
      }),
    });
    return parseResearchPlan(content, researchInput);
  }

  async function buildResearchContext(run, context, options = {}) {
    const researchInput = String(options.researchInput || run.input);
    if (run.runtimeVersion >= 3 && !authorizationAllowsCapability(context.authorization, 'web_research')) return '';
    if (!wantsWebResearch(researchInput)) return '';
    const { queries, officialDomains } = await createResearchPlan(run, context, researchInput);
    if (queries.length === 0) return '';
    const provider = context.tavilyApiKey ? 'tavily' : 'duckduckgo';
    addEvent(run.id, 'WEB_SEARCH_STARTED', `开始通过 ${provider === 'tavily' ? 'Tavily' : 'DuckDuckGo'} 执行 ${queries.length} 次受控联网检索`, {
      queries,
      provider,
      refreshed: Boolean(options.refreshed),
    });
    try {
      let result = await search(queries, context.tavilyApiKey, {
        officialDomains,
        requirements: researchRequirements(researchInput),
      });
      if (!result.audit?.accepted) {
        const followupQuery = remediationQuery(queries, result.audit);
        if (followupQuery) {
          addEvent(run.id, 'WEB_SEARCH_RETRYING', '首次来源验收未通过，正在针对证据缺口补查一次', {
            query: followupQuery,
            issues: result.audit.issues || [],
          });
          result = await search(normalizeSearchQueries([queries[0], followupQuery]), context.tavilyApiKey, {
            officialDomains,
            requirements: researchRequirements(researchInput),
          });
        }
      }
      context.researchAudit = result.audit;
      context.researchSources = result.sources.map((source) => ({ url: source.url }));
      addEvent(run.id, 'WEB_SEARCH_COMPLETED', `联网检索完成，获得 ${result.resultCount} 条来源`, {
        queries,
        provider: result.provider,
        officialDomains: result.officialDomains,
        timeRange: result.timeRange,
        resultCount: result.resultCount,
        audit: result.audit,
        context: result.context,
        sources: result.sources.map((source, index) => ({
          index: index + 1,
          url: source.url,
          domain: source.domain,
          title: source.title,
          publishedDate: source.publishedDate,
          retrievedAt: source.retrievedAt,
          sourceTier: source.sourceTier,
          isPrimary: source.isPrimary,
          extractionStatus: source.extractionStatus,
        })),
        refreshed: Boolean(options.refreshed),
      });
      return result.context;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addEvent(run.id, 'WEB_SEARCH_FAILED', '联网检索失败，任务将基于已有信息继续', {
        error: message.slice(0, 500),
      });
      return `联网检索失败：${message.slice(0, 500)}。不要虚构搜索结果或最新信息，明确说明此限制。`;
    }
  }

  return {
    buildResearchContext,
    restoreResearchAudit,
    restoreResearchContext,
    restoreResearchResultAudits,
    restoreResearchSources,
    taskNeedsResearchContext,
  };
}
