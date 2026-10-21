import prisma from '@/app/api/_lib/db';
import { indexKnowledgeText } from '@/lib/knowledge';
import { isDuplicateMemory } from '@/lib/personal-assistant/memory-dedup.mjs';
import { fetchStudyContent } from './content-provider';
import { assessStudyContents } from './knowledge-assessor';
import {
  buildStudyKnowledgeMarkdown,
  MIN_ACTIVE_CONFIDENCE,
  shouldIngestAsKnowledge,
} from './content-kind';
import { loadDailyStudyRecord, saveDailyStudyRecord } from './storage';
import type { AgentDailyStudyRecord } from './types';

type StudyModelConfig = {
  apiBaseUrl?: string;
  apiKey?: string;
  modelName?: string;
};

export interface StudyIngestResult {
  knowledgeIds: Record<string, string>;
  memoryCount: number;
  skipped: string[];
  kinds: Record<string, string>;
  errors: string[];
}

const inFlight = new Set<string>();

function resolveRepository() {
  const db: any = (prisma as any)?.default || prisma;
  return db;
}

async function writeStudyMemory(userId: string, agentId: string, content: string) {
  const cleaned = String(content || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!cleaned) return false;

  const db = resolveRepository();
  const existing = await db.agentMemoryItem.findMany({
    where: { userId, agentId, status: 'ACTIVE' },
    select: { content: true },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });
  if (isDuplicateMemory(cleaned, existing.map((item: { content: string }) => item.content))) return false;

  await db.agentMemoryItem.create({
    data: {
      userId,
      agentId,
      category: 'fact',
      content: cleaned,
      status: 'ACTIVE',
    },
  });
  return true;
}

/**
 * 把当天的研习成果按内容类型分流：
 * - knowledge      → KnowledgeDocument（带来源与去重键），可被 RAG 召回
 * - personal_fact  → 长期记忆（相似度去重）
 * - news / opinion → 只保留在 AgentExperience，作为“见闻”
 */
export async function ingestStudyKnowledge(
  record: AgentDailyStudyRecord,
  modelConfig?: StudyModelConfig
): Promise<StudyIngestResult> {
  const result: StudyIngestResult = {
    knowledgeIds: {},
    memoryCount: 0,
    skipped: [],
    kinds: {},
    errors: [],
  };
  if (!record.userId || record.items.length === 0) return result;

  // 1. 为可沉淀来源抓取正文；视频/娱乐来源直接跳过
  const contents = await Promise.all(record.items.map((item) => fetchStudyContent(item)));
  const fetched = contents.filter((content) => content.fetched);
  for (const content of contents) {
    if (!content.fetched) {
      result.skipped.push(`${content.id}:${content.reason || 'no_content'}`);
    }
  }
  if (fetched.length === 0) return result;

  // 2. 一次性判定资讯 / 观点 / 知识 / 稳定事实
  const itemById = new Map(record.items.map((item) => [item.id, item]));
  const assessments = await assessStudyContents({
    agent: { name: record.agentName },
    items: fetched
      .map((content) => {
        const item = itemById.get(content.id);
        return item ? { item, content: content.text } : null;
      })
      .filter((entry): entry is { item: (typeof record.items)[number]; content: string } => Boolean(entry)),
    modelConfig,
  });

  // 3. 分流沉淀
  for (const content of fetched) {
    const item = itemById.get(content.id);
    if (!item) continue;
    const assessment = assessments.get(content.id);
    if (!assessment) continue;
    result.kinds[item.id] = assessment.contentKind;

    if (assessment.contentKind === 'personal_fact' && assessment.summary) {
      const created = await writeStudyMemory(record.userId, record.agentId, assessment.summary);
      if (created) result.memoryCount += 1;
      continue;
    }

    if (!shouldIngestAsKnowledge({ source: content.source, content: content.text, assessment })) {
      result.skipped.push(`${item.id}:not_knowledge:${assessment.contentKind}`);
      continue;
    }

    try {
      const indexed = await indexKnowledgeText(
        { agentId: record.agentId, userId: record.userId },
        {
          title: assessment.title || item.title,
          fileName: `study-${record.date}-${item.id}.md`,
          content: buildStudyKnowledgeMarkdown({
            item,
            assessment,
            date: record.date,
            content: content.text,
          }),
          sourceType: 'STUDY',
          sourceKey: item.id,
          sourceUrl: item.url,
          summary: assessment.summary,
          tags: ['study', record.date, item.source, assessment.category || ''].filter(Boolean),
          status: assessment.confidence >= MIN_ACTIVE_CONFIDENCE ? 'ACTIVE' : 'DRAFT',
        }
      );
      result.knowledgeIds[item.id] = indexed.document.id;
    } catch (error: any) {
      result.errors.push(`${item.id}:${error?.message || 'index_failed'}`);
      console.warn('[AgentStudy] Knowledge ingestion failed:', item.id, error?.message);
    }
  }

  // 4. 回链到当天的研习记录，便于 UI 从卡片跳到知识库
  if (Object.keys(result.knowledgeIds).length > 0) {
    try {
      const latest = await loadDailyStudyRecord(record.agentId, record.date, record.userId);
      if (latest) {
        latest.items = latest.items.map((item) =>
          result.knowledgeIds[item.id] ? { ...item, knowledgeId: result.knowledgeIds[item.id] } : item
        );
        latest.updatedAt = new Date().toISOString();
        await saveDailyStudyRecord(latest);
      }
    } catch (error: any) {
      console.warn('[AgentStudy] Failed to link knowledge back to study record:', error?.message);
    }
  }

  return result;
}

/**
 * 后台执行沉淀，避免阻塞当天的研习卡片首次加载。
 * 同一天的记录只允许一个在途任务。
 */
export function scheduleStudyKnowledgeIngestion(
  record: AgentDailyStudyRecord,
  modelConfig?: StudyModelConfig
) {
  if (!record.userId || record.items.length === 0 || record.knowledgeIngestedAt) return;
  // 失败重试冷却：上次沉淀失败（只有诊断、没有完成标记）时，1 小时内不重复尝试
  if (
    record.knowledgeIngest?.at &&
    Date.now() - Date.parse(record.knowledgeIngest.at) < 60 * 60 * 1000
  ) {
    return;
  }
  const key = `${record.userId}:${record.agentId}:${record.date}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);

  void ingestStudyKnowledge(record, modelConfig)
    .then(async (result) => {
      const latest = await loadDailyStudyRecord(record.agentId, record.date, record.userId);
      if (!latest) return;
      const at = new Date().toISOString();
      latest.knowledgeIngestedAt = at;
      latest.knowledgeIngest = {
        at,
        knowledgeCount: Object.keys(result.knowledgeIds).length,
        memoryCount: result.memoryCount,
        kinds: result.kinds,
        skipped: result.skipped,
        errors: result.errors,
      };
      latest.updatedAt = at;
      await saveDailyStudyRecord(latest);
    })
    .catch(async (error: any) => {
      console.warn('[AgentStudy] Background knowledge ingestion failed:', error?.message);
      // 致命失败也要落诊断，否则界面上完全看不到原因；但不写 knowledgeIngestedAt，允许冷却后重试
      try {
        const latest = await loadDailyStudyRecord(record.agentId, record.date, record.userId);
        if (!latest) return;
        const at = new Date().toISOString();
        latest.knowledgeIngest = {
          at,
          knowledgeCount: 0,
          memoryCount: 0,
          kinds: {},
          skipped: [],
          errors: [`fatal:${String(error?.message || error).slice(0, 200)}`],
        };
        latest.updatedAt = at;
        await saveDailyStudyRecord(latest);
      } catch {
        // 诊断写入失败时不再抛错
      }
    })
    .finally(() => {
      inFlight.delete(key);
    });
}
