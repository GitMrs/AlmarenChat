import { resolveAgent } from '@/app/api/_lib/spaces';
import { matchAgentStudyCandidates } from './interest-matcher';
import { distillDailyStudy } from './study-engine';
import {
  getLocalISODate,
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
  modelConfig?: {
    apiBaseUrl?: string;
    apiKey?: string;
    modelName?: string;
  };
}

/**
 * 获取或按需生成指定 Agent 当天的自主学习成果
 */
export async function getOrGenerateDailyStudy(
  agentId: string,
  userId?: string,
  options: GetDailyStudyOptions = {}
): Promise<AgentDailyStudyRecord> {
  const date = options.date || getLocalISODate();
  const existing = await loadDailyStudyRecord(agentId, date, userId);

  // 1. 若未强制刷新，优先从持久化缓存读取（保证日内稳定一致，极速 0ms）
  if (!options.forceRefresh) {
    if (existing) {
      return existing;
    }
  }

  // 2. 解析 Agent 实体信息
  const agent = await resolveAgent(agentId, userId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  // 3. 根据 Agent 偏好与全网热点匹配 3 条候选
  let candidates = await matchAgentStudyCandidates(agent, {
    limit: 3,
    excludeIds: new Set(existing?.items.map((item) => item.id) || []),
  });
  // A small trending pool should still produce a usable daily record.
  if (candidates.length < 3) {
    candidates = await matchAgentStudyCandidates(agent, { limit: 3 });
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
