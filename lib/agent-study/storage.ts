import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import prisma from '@/app/api/_lib/db';
import type { AgentDailyStudyRecord, AgentStudyItem } from './types';

const AGENT_STUDY_DIR = path.join(process.cwd(), 'data', 'agent-study');
const SETTINGS_FILE_PATH = path.join(AGENT_STUDY_DIR, 'settings.json');
const SOURCE_MODES_FILE_PATH = path.join(AGENT_STUDY_DIR, 'source-modes.json');

/**
 * 获取 Agent 的学习源模式：'internal'（全网热点）或 'bilibili'（B站主动搜索）
 * 优先从数据库 AgentModelSetting 表读取
 */
export async function getAgentStudySourceMode(
  agentId: string,
  userId?: string
): Promise<'internal' | 'bilibili'> {
  const db: any = (prisma as any)?.default || prisma;

  if (userId && db?.agentModelSetting?.findUnique) {
    try {
      const record = await db.agentModelSetting.findUnique({
        where: {
          userId_agentId: {
            userId,
            agentId,
          },
        },
        select: {
          dailyStudySourceMode: true,
        },
      });
      if (record?.dailyStudySourceMode === 'bilibili') {
        return 'bilibili';
      }
      if (record?.dailyStudySourceMode === 'internal') {
        return 'internal';
      }
    } catch (err) {
      console.warn('[AgentStudy] Query dailyStudySourceMode failed:', err);
    }
  }

  // 兜底本地文件
  try {
    const raw = await readFile(SOURCE_MODES_FILE_PATH, 'utf-8');
    const map = JSON.parse(raw);
    const key = userId ? `${userId}:${agentId}` : agentId;
    if (map[key] === 'bilibili' || map[agentId] === 'bilibili') return 'bilibili';
  } catch {}
  return 'internal';
}

/**
 * 设置 Agent 的学习源模式
 * 同步持久化写入数据库 AgentModelSetting 表并备份本地文件
 */
export async function setAgentStudySourceMode(
  agentId: string,
  mode: 'internal' | 'bilibili',
  userId?: string
): Promise<'internal' | 'bilibili'> {
  const db: any = (prisma as any)?.default || prisma;

  if (userId && db?.agentModelSetting?.upsert) {
    try {
      await db.agentModelSetting.upsert({
        where: {
          userId_agentId: {
            userId,
            agentId,
          },
        },
        create: {
          userId,
          agentId,
          dailyStudySourceMode: mode,
        },
        update: {
          dailyStudySourceMode: mode,
          updatedAt: new Date(),
        },
      });
    } catch (err) {
      console.warn('[AgentStudy] Upsert AgentModelSetting dailyStudySourceMode failed:', err);
    }
  }

  // 同步本地文件备份
  try {
    await mkdir(AGENT_STUDY_DIR, { recursive: true });
    let map: Record<string, string> = {};
    try {
      const raw = await readFile(SOURCE_MODES_FILE_PATH, 'utf-8');
      map = JSON.parse(raw);
    } catch {}
    const key = userId ? `${userId}:${agentId}` : agentId;
    map[key] = mode;
    const tmpPath = `${SOURCE_MODES_FILE_PATH}.${Date.now()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(map, null, 2), 'utf-8');
    const { rename } = await import('node:fs/promises');
    await rename(tmpPath, SOURCE_MODES_FILE_PATH);
  } catch (err) {
    console.warn('[AgentStudy] setAgentStudySourceMode backup failed:', err);
  }
  return mode;
}

/**
 * 判断 Agent 是否开启了自主学习
 * 优先从数据库 AgentModelSetting 表中读取该用户的针对该 Agent 的设置
 * 默认规则：仅 Sunny (companion-nari / nari) 默认开启，其余默认关闭
 */
export async function isAgentStudyEnabled(
  agentId: string,
  userIdOrCache?: string | Record<string, boolean>,
  settingsCache?: Record<string, boolean>
): Promise<boolean> {
  const db: any = (prisma as any)?.default || prisma;
  let userId: string | undefined;
  let cache: Record<string, boolean> | undefined;

  if (typeof userIdOrCache === 'string') {
    userId = userIdOrCache;
    cache = settingsCache;
  } else if (userIdOrCache && typeof userIdOrCache === 'object') {
    cache = userIdOrCache;
  }

  if (userId && db?.agentModelSetting?.findUnique) {
    try {
      const record = await db.agentModelSetting.findUnique({
        where: {
          userId_agentId: {
            userId,
            agentId,
          },
        },
        select: {
          dailyStudyEnabled: true,
        },
      });
      if (record && typeof record.dailyStudyEnabled === 'boolean') {
        return record.dailyStudyEnabled;
      }
    } catch (err) {
      console.warn('[AgentStudy] Query AgentModelSetting failed:', err);
    }
  }

  // The legacy file is process-wide and cannot safely represent per-user settings.
  // Only consult it for offline callers that do not have an authenticated user.
  if (!userId && cache && typeof cache[agentId] === 'boolean') {
    return cache[agentId];
  }

  // 默认规则：仅 Sunny 默认开启
  return agentId === 'companion-nari' || agentId === 'nari';
}

/**
 * 读取所有 Agent 的自主学习开关配置快照
 */
export async function getAgentStudySettings(): Promise<Record<string, boolean>> {
  try {
    const raw = await readFile(SETTINGS_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, boolean>;
    }
  } catch {
    // 首次读取或文件未创建
  }
  return {};
}

/**
 * 设置指定 Agent 的自主学习开关状态，保存至数据库 AgentModelSetting 表
 */
export async function setAgentStudyEnabled(
  agentId: string,
  enabled: boolean,
  userId?: string
): Promise<boolean> {
  const db: any = (prisma as any)?.default || prisma;

  if (userId && db?.agentModelSetting?.upsert) {
    try {
      await db.agentModelSetting.upsert({
        where: {
          userId_agentId: {
            userId,
            agentId,
          },
        },
        create: {
          userId,
          agentId,
          dailyStudyEnabled: enabled,
        },
        update: {
          dailyStudyEnabled: enabled,
          updatedAt: new Date(),
        },
      });
    } catch (err) {
      console.warn('[AgentStudy] Upsert AgentModelSetting dailyStudyEnabled failed:', err);
    }
  }

  // 同步本地文件备份（用于离线与快速回退）
  try {
    await mkdir(AGENT_STUDY_DIR, { recursive: true });
    const settings = await getAgentStudySettings();
    settings[agentId] = enabled;
    const tmpPath = `${SETTINGS_FILE_PATH}.${Date.now()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(settings, null, 2), 'utf-8');
    const { rename } = await import('node:fs/promises');
    await rename(tmpPath, SETTINGS_FILE_PATH);
  } catch {}

  return enabled;
}

export function getLocalISODate(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().split('T')[0];
}

/**
 * 研习生成成功后调用：确保 (userId, agentId) 在 AgentModelSetting 表中有一行
 * dailyStudyEnabled=true，让后台调度器能发现"默认开启"的 Agent。
 * 已存在显式值（含用户手动关闭的 false）时绝不覆盖。
 */
export async function ensureStudyEnabledObserved(
  agentId: string,
  userId?: string
): Promise<void> {
  if (!userId) return;
  const db: any = (prisma as any)?.default || prisma;
  if (!db?.agentModelSetting?.findUnique || !db?.agentModelSetting?.upsert) return;

  try {
    const existing = await db.agentModelSetting.findUnique({
      where: { userId_agentId: { userId, agentId } },
      select: { dailyStudyEnabled: true },
    });
    if (existing && typeof existing.dailyStudyEnabled === 'boolean') return;

    await db.agentModelSetting.upsert({
      where: { userId_agentId: { userId, agentId } },
      create: { userId, agentId, dailyStudyEnabled: true },
      update: { dailyStudyEnabled: true, updatedAt: new Date() },
    });
  } catch (err) {
    console.warn('[AgentStudy] ensureStudyEnabledObserved failed:', err);
  }
}

function getRecordFilePath(date: string, agentId: string, userId?: string): string {
  const safeAgentId = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeDate = date.replace(/[^0-9-]/g, '_');
  const safeUserId = userId?.replace(/[^a-zA-Z0-9_-]/g, '_');
  return safeUserId
    ? path.join(AGENT_STUDY_DIR, safeUserId, safeDate, `${safeAgentId}.json`)
    : path.join(AGENT_STUDY_DIR, safeDate, `${safeAgentId}.json`);
}

/**
 * 读取当天该 Agent 的持久化学习档案
 */
export async function loadDailyStudyRecord(
  agentId: string,
  date: string = getLocalISODate(),
  userId?: string
): Promise<AgentDailyStudyRecord | null> {
  const filePath = getRecordFilePath(date, agentId, userId);
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.items)) {
      return parsed as AgentDailyStudyRecord;
    }
  } catch {
    // 未生成或文件不存在
  }
  return null;
}

/**
 * 原子保存当天该 Agent 的学习档案
 */
export async function saveDailyStudyRecord(record: AgentDailyStudyRecord): Promise<void> {
  const filePath = getRecordFilePath(record.date, record.agentId, record.userId);
  const dirPath = path.dirname(filePath);
  await mkdir(dirPath, { recursive: true });

  const tmpPath = `${filePath}.${Date.now()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(record, null, 2), 'utf-8');
  const { rename } = await import('node:fs/promises');
  await rename(tmpPath, filePath);
}

/**
 * 将学习记录同步沉淀到 Prisma 的 AgentExperience 表（成长经历流水）
 */
export async function syncStudyToAgentExperience(
  userId: string,
  record: AgentDailyStudyRecord
): Promise<void> {
  if (!userId || !record.items.length) return;
  const db: any = (prisma as any)?.default || prisma;
  if (!db?.agentExperience?.upsert) return;

  for (const item of record.items) {
    const taskId = `study:${record.date}:${item.id}`;
    const title = `自主研习了《${item.title}》`;
    const summary = [
      `【角色心得】${item.thoughts}`,
      `【干货要点】${item.summary}`,
      `来源平台：${item.sourceName} | 原链接：${item.url}`,
    ].join('\n\n');

    try {
      await db.agentExperience.upsert({
        where: {
          userId_agentId_taskId: {
            userId,
            agentId: record.agentId,
            taskId,
          },
        },
        create: {
          userId,
          agentId: record.agentId,
          taskId,
          title,
          summary,
          outcome: 'ACCEPTED',
          sourceType: 'STUDY',
          tags: ['study', item.source, `heat:${item.heat || ''}`],
        },
        update: {
          title,
          summary,
          updatedAt: new Date(),
        },
      });
    } catch (err) {
      console.warn(`[AgentStudy] Failed to upsert AgentExperience for ${taskId}:`, err);
    }
  }
}

/**
 * 获取 Agent 近期（默认 30 天内）已经研习过的所有素材 ID，包括：
 * 1. 数据库 AgentExperience 表中的研习经历（taskId 格式 study:YYYY-MM-DD:itemId）
 * 2. 数据库 KnowledgeDocument 表中的研习知识文档 sourceKey
 * 用于全局防重，确保未来每天自主学习绝不挑中已学过的重复内容
 */
export async function getRecentlyStudiedItemIds(
  agentId: string,
  days: number = 30
): Promise<Set<string>> {
  const ids = new Set<string>();
  const db: any = (prisma as any)?.default || prisma;

  if (db?.agentExperience?.findMany) {
    try {
      const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const experiences = await db.agentExperience.findMany({
        where: {
          agentId,
          sourceType: 'STUDY',
          createdAt: { gte: sinceDate },
        },
        select: { taskId: true },
      });
      for (const exp of experiences) {
        if (exp.taskId && exp.taskId.startsWith('study:')) {
          const parts = exp.taskId.split(':');
          if (parts.length >= 3) {
            ids.add(parts.slice(2).join(':'));
          }
        }
      }
    } catch (err) {
      console.warn('[AgentStudy] Query recent AgentExperience failed:', err);
    }
  }

  if (db?.knowledgeDocument?.findMany) {
    try {
      const docs = await db.knowledgeDocument.findMany({
        where: {
          agentId,
          sourceType: 'STUDY',
          sourceKey: { not: null },
        },
        select: { sourceKey: true },
      });
      for (const doc of docs) {
        if (doc.sourceKey) {
          ids.add(doc.sourceKey);
        }
      }
    } catch (err) {
      console.warn('[AgentStudy] Query recent KnowledgeDocument failed:', err);
    }
  }

  return ids;
}
