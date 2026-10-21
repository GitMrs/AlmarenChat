import { resolveAgent } from '@/app/api/_lib/spaces';
import { matchAgentStudyCandidates } from './interest-matcher';
import { distillDailyStudy } from './study-engine';
import { scheduleStudyKnowledgeIngestion } from './ingest';
import {
  ensureStudyEnabledObserved,
  getAgentStudySourceMode,
  getLocalISODate,
  getRecentlyStudiedItemIds,
  loadDailyStudyRecord,
  saveDailyStudyRecord,
  syncStudyToAgentExperience,
} from './storage';
import type { AgentDailyStudyRecord } from './types';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const STUDY_ROOT = path.join(process.cwd(), 'data', 'agent-study');

export interface GetDailyStudyOptions {
  date?: string;
  forceRefresh?: boolean;
  sourceMode?: 'internal' | 'bilibili';
  modelConfig?: {
    apiBaseUrl?: string;
    apiKey?: string;
    modelName?: string;
  };
}

/**
 * 获取或按需生成指定 Agent 当天的自主学习成果（带 in-flight 去重，
 * 调度器/聊天页/接口同时触发同一份研习时只跑一遍）
 */
const inflightGenerations = new Map<string, Promise<AgentDailyStudyRecord>>();

export function getOrGenerateDailyStudy(
  agentId: string,
  userId?: string,
  options: GetDailyStudyOptions = {}
): Promise<AgentDailyStudyRecord> {
  const date = options.date || getLocalISODate();
  // forceRefresh 的调用意图是显式重算，不参与去重
  if (options.forceRefresh) {
    return getOrGenerateDailyStudyInternal(agentId, userId, { ...options, date });
  }
  const key = `${userId || '-'}|${agentId}|${date}`;
  const pending = inflightGenerations.get(key);
  if (pending) return pending;
  const task = getOrGenerateDailyStudyInternal(agentId, userId, { ...options, date })
    .finally(() => {
      if (inflightGenerations.get(key) === task) inflightGenerations.delete(key);
    });
  inflightGenerations.set(key, task);
  return task;
}

async function getOrGenerateDailyStudyInternal(
  agentId: string,
  userId?: string,
  options: GetDailyStudyOptions = {}
): Promise<AgentDailyStudyRecord> {
  const date = options.date || getLocalISODate();
  const existing = await loadDailyStudyRecord(agentId, date, userId);

  // 1. 若未强制刷新，优先从持久化缓存读取（保证日内稳定一致，极速 0ms）
  if (!options.forceRefresh) {
    if (existing) {
      // 当天已生成但知识尚未沉淀时，后台补齐（不阻塞卡片渲染）
      if (userId) scheduleStudyKnowledgeIngestion(existing, options.modelConfig);
      return existing;
    }
  }

  // 2. 解析 Agent 实体信息与学习源模式配置
  const agent = await resolveAgent(agentId, userId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  // 判定模式：'internal'（纯走内部全网热点）或 'bilibili'（走 B 站主动搜索）
  const sourceMode = options.sourceMode || (await getAgentStudySourceMode(agentId, userId));
  const enableBilibiliSearch = sourceMode === 'bilibili';

  // 3. 根据 Agent 偏好与候选源匹配 3 条候选，加载近期已研习过的素材 ID，严防重复研习
  const excludeIds = await getRecentlyStudiedItemIds(agentId, 30);
  if (existing?.items) {
    for (const item of existing.items) {
      excludeIds.add(item.id);
    }
  }

  let candidates = await matchAgentStudyCandidates(agent, {
    limit: 3,
    knowledgeQuota: 1,
    enableBilibiliSearch,
    excludeIds,
  });
  // 若候选数不足 3 条，尝试放宽知识配额（允许资讯/热搜补充），但仍严格遵守历史去重
  if (candidates.length < 3) {
    candidates = await matchAgentStudyCandidates(agent, {
      limit: 3,
      knowledgeQuota: 0,
      enableBilibiliSearch,
      excludeIds,
    });
  }

  // 4. 调用大模型进行角色化提炼（干货 + 伴侣第一人称感悟 + 今日问候）
  const distilled = await distillDailyStudy(agent, candidates, options.modelConfig);

  const nowIso = new Date().toISOString();
  const record: AgentDailyStudyRecord = {
    agentId,
    userId,
    agentName: agent.name,
    agentAvatar: agent.avatar || undefined,
    date,
    greeting: distilled.greeting,
    items: distilled.items,
    sharedWithUser: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  // 5. 保存本地档案
  await saveDailyStudyRecord(record);

  // 6. 同步至数据库 AgentExperience 表（成长经历）
  if (userId) {
    await syncStudyToAgentExperience(userId, record);
    // 7. 后台沉淀：知识进知识库、稳定事实进记忆
    scheduleStudyKnowledgeIngestion(record, options.modelConfig);
    // 8. 落库开关行，让后台调度器能发现该 Agent（不覆盖用户显式关闭）
    void ensureStudyEnabledObserved(agentId, userId).catch(() => {});
  }

  return record;
}

/**
 * 标记该 Agent 今日学习成果已被用户查阅/分享
 */
export async function markDailyStudyShared(
  agentId: string,
  date: string = getLocalISODate(),
  userId?: string
): Promise<AgentDailyStudyRecord | null> {
  let record = await loadDailyStudyRecord(agentId, date, userId);
  // Keep the old internal API usable for migration scripts/tests that do not
  // carry a user id. Authenticated HTTP callers always pass userId.
  if (!record && !userId) {
    try {
      const entries = await readdir(STUDY_ROOT, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || /^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
        record = await loadDailyStudyRecord(agentId, date, entry.name);
        if (record) break;
      }
    } catch {}
  }
  if (!record) return null;

  record.sharedWithUser = true;
  record.updatedAt = new Date().toISOString();
  await saveDailyStudyRecord(record);
  return record;
}
