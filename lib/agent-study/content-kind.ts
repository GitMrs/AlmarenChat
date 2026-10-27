import type { AgentStudyItem } from './types';

/** 实测可稳定抓到长正文的来源，用于每日“知识配额”选题 */
export const KNOWLEDGE_FETCHABLE_SOURCES = new Set([
  'juejin',
  'sspai',
  'csdn',
  'github',
  'hellogithub',
]);

/** 只有能产出正文的文章/仓库类来源才允许沉淀为知识；视频类依赖字幕/ASR，无正文的资讯类（36氪/IT之家）不在此列 */
export const KNOWLEDGE_ELIGIBLE_SOURCES = new Set([
  'zhihu',
  'juejin',
  'sspai',
  'csdn',
  'hellogithub',
  'github',
  'bilibili',
  'youtube',
]);

/** 正文低于该长度视为“只有标题/简介”，不建知识 */
export const MIN_KNOWLEDGE_CONTENT_CHARS = 800;
/** 离线兜底写入知识库 Markdown 时摘录的代表性正文上限（首/中/尾三段采样，避免万字口语流水账） */
export const MAX_STUDY_EXCERPT_CHARS = 1800;
/** 分型置信度低于该值时知识进入草稿，不参与检索。设为 0.75 严把入库质量门槛 */
export const MIN_ACTIVE_CONFIDENCE = 0.75;

export type StudyContentKind = 'news' | 'opinion' | 'knowledge' | 'personal_fact';

export interface StudyGrowthCandidate {
  type: 'BELIEF' | 'REFLECTION' | 'REVISION';
  title: string;
  content: string;
  evidence: string;
  confidence: number;
  previousEventId?: string;
}

export interface StudyPreviousBelief {
  id: string;
  content: string;
}

/** AI 只能提出候选；证据必须来自原文，修正必须能对应已有判断。 */
export function validateStudyGrowth(
  raw: unknown,
  source: string,
  previousBeliefs: StudyPreviousBelief[] = [],
): StudyGrowthCandidate | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const value = raw as Record<string, unknown>;
  if (!['BELIEF', 'REFLECTION', 'REVISION'].includes(String(value.type))) return;
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0.8 || value.confidence > 1) return;
  const clean = (input: unknown) => typeof input === 'string' ? input.trim() : '';
  const title = clean(value.title);
  const content = clean(value.content);
  const evidence = clean(value.evidence);
  if (!title || title.length > 160 || !content || content.length > 1200 || evidence.length < 10 || evidence.length > 500) return;
  if (!source.replace(/\s+/g, '').includes(evidence.replace(/\s+/g, ''))) return;
  const previousEventId = clean(value.previousEventId);
  if (value.type === 'REVISION' && !previousBeliefs.some((belief) => belief.id === previousEventId)) return;
  return {
    type: value.type as StudyGrowthCandidate['type'], title, content, evidence,
    confidence: value.confidence,
    ...(value.type === 'REVISION' ? { previousEventId } : {}),
  };
}

export interface StudyContentAssessment {
  id: string;
  contentKind: StudyContentKind;
  category?: string;
  title?: string;
  summary: string;
  keyPoints: string[];
  confidence: number;
  growth?: StudyGrowthCandidate;
}

export function isKnowledgeEligibleSource(source: string) {
  return KNOWLEDGE_ELIGIBLE_SOURCES.has(String(source || '').toLowerCase());
}

export function normalizeContentKind(value: unknown): StudyContentKind {
  return ['news', 'opinion', 'knowledge', 'personal_fact'].includes(String(value))
    ? (String(value) as StudyContentKind)
    : 'news';
}

/**
 * 1. 没有正文 → 只能是资讯/见闻，不进知识库
 * 2. 分型不是 knowledge → 不进知识库
 */
export function shouldIngestAsKnowledge(options: {
  source: string;
  content: string;
  assessment?: Pick<StudyContentAssessment, 'contentKind'>;
}) {
  if (!isKnowledgeEligibleSource(options.source)) return false;
  if (String(options.content || '').trim().length < MIN_KNOWLEDGE_CONTENT_CHARS) return false;
  return options.assessment?.contentKind === 'knowledge';
}

/**
 * 为超长字幕/长文生成「开篇 + 中段 + 结尾」三段代表性摘录，并严格对齐句子边界。
 * 相比于简单取前 N 字，能保证视频中后段的核心操作步骤与最终结论不被丢弃。
 */
export function buildRepresentativeExcerpt(
  text: string,
  maxChars: number = MAX_STUDY_EXCERPT_CHARS
): string {
  const clean = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!clean) return '';
  const budget = Math.max(300, Math.floor(maxChars));
  if (clean.length <= budget) return clean;

  const snapEnd = (segment: string) => {
    const idx = segment.search(/[。！？!?；;\n][^。！？!?；;\n]*$/);
    return idx > Math.floor(segment.length * 0.45) ? segment.slice(0, idx + 1).trim() : segment.trim();
  };
  const snapStart = (segment: string) => {
    const idx = segment.search(/[。！？!?；;\n]/);
    return idx >= 0 && idx < Math.floor(segment.length * 0.35)
      ? segment.slice(idx + 1).trim()
      : segment.trim();
  };

  const partSize = Math.max(120, Math.floor(budget / 3));
  const head = snapEnd(clean.slice(0, partSize));
  const midStart = Math.max(partSize, Math.floor(clean.length / 2 - partSize / 2));
  const mid = snapEnd(snapStart(clean.slice(midStart, midStart + partSize)));
  const tailStart = Math.max(midStart + partSize, clean.length - partSize);
  const tail = snapStart(clean.slice(tailStart));

  return [
    `【开篇部分】\n${head}`,
    mid ? `【中段展开】\n${mid}` : '',
    tail ? `【结尾结论】\n${tail}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * 构建可被 Markdown 章节感知分块器正确切分的学习笔记。
 * 优先采用结合 Agent 人设与专业视角深度萃取的 Markdown 结构，杜绝原始字幕与生硬截断。
 */
export function buildStudyKnowledgeMarkdown(options: {
  item: Pick<AgentStudyItem, 'title' | 'sourceName' | 'url'>;
  assessment: Pick<StudyContentAssessment, 'title' | 'summary' | 'keyPoints' | 'category'>;
  date: string;
  content?: string;
  synthesizedContent?: string;
  agentName?: string;
}) {
  const { item, assessment, date, synthesizedContent, agentName } = options;
  const title = String(assessment.title || item.title || '未命名知识').trim();

  const authorPrefix = agentName ? `研习者：${agentName} | ` : '';
  const blocks: string[] = [
    `# ${title}`,
    `> ${authorPrefix}来源：${item.sourceName || '网络'} | ${item.url || ''} | 研习日期：${date}`,
  ];
  if (assessment.category) blocks.push(`> 领域分类：${assessment.category}`);

  // 1. 如果有 AI 结合角色人设深度萃取的结构化正文，直接作为完整专业笔记输出（结构闭环，绝不截断）
  if (synthesizedContent && synthesizedContent.trim().length > 50) {
    let body = synthesizedContent.trim();
    if (body.startsWith('# ')) {
      const idx = body.indexOf('\n');
      if (idx > 0) body = body.slice(idx).trim();
    }
    blocks.push('', body);
    return blocks.join('\n');
  }

  // 2. 兜底回退：结构化摘要与核心要点 + 首/中/尾代表性原文摘录（对齐 bilibili_learning_bot.local_note 诚实降级规范）
  blocks.push(
    '',
    '> [!WARNING] 本条为 AI 深度笔记合成不可用时生成的本地降级归档，以下为分型摘要与原始首/中/尾摘录。',
    '',
    '## 摘要',
    assessment.summary || ''
  );
  const keyPoints = (assessment.keyPoints || []).map((point) => `- ${point}`).filter(Boolean);
  if (keyPoints.length > 0) blocks.push('', '## 关键要点', ...keyPoints);

  const excerpt = buildRepresentativeExcerpt(options.content || '', MAX_STUDY_EXCERPT_CHARS);
  if (excerpt) {
    blocks.push('', '## 原文', excerpt);
  }

  return blocks.join('\n');
}

/**
 * 从角色深度合成笔记或评估结果中提炼可复用的「角色专属技能卡（Skill Card）」，
 * 存入 AgentMemoryItem (category: 'skill')，供日常对话按 2-gram 词重合度秒级触发调用。
 */
export function extractStudySkillMemory(options: {
  title: string;
  summary: string;
  keyPoints?: string[];
  synthesizedContent?: string | null;
}): string | null {
  const title = String(options.title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!title) return null;

  const synthesized = String(options.synthesizedContent || '').replace(/\r\n/g, '\n').trim();
  let trigger = '';
  let steps = '';
  let review = '';

  if (synthesized) {
    const triggerMatch = synthesized.match(
      /(?:场景中的应用|角色场景迁移)[*＊：:\s]*([^\n]+)/i
    );
    if (triggerMatch?.[1]) {
      trigger = triggerMatch[1].replace(/^[-*•\s]+/, '').trim();
    }

    const reviewMatch = synthesized.match(
      /(?:一句话复习|一句话角色复盘)[*＊：:\s]*([^\n]+)/i
    );
    if (reviewMatch?.[1]) {
      review = reviewMatch[1].replace(/^[-*•\s]+/, '').trim();
    }

    const methodSection = synthesized.match(
      /##\s*方法论与实操步骤\s*\n([\s\S]*?)(?=\n##\s|$)/
    );
    if (methodSection?.[1]) {
      const cleanMethod = methodSection[1]
        .split('\n')
        .map((line) => line.replace(/^[-*•\s]+/, '').trim())
        .filter((line) => line && !/原文未专门|不包含操作步骤/.test(line))
        .slice(0, 4)
        .join('；');
      if (cleanMethod.length >= 10) {
        steps = cleanMethod;
      }
    }
  }

  if (!steps && Array.isArray(options.keyPoints) && options.keyPoints.length > 0) {
    steps = options.keyPoints
      .map((pt) => String(pt || '').trim())
      .filter(Boolean)
      .slice(0, 4)
      .join('；');
  }
  if (!steps && options.summary) {
    steps = String(options.summary).replace(/\s+/g, ' ').trim();
  }
  if (!steps || steps.length < 8) return null;

  const parts = [`【${title}】`];
  if (trigger) parts.push(`适用场景：${trigger.slice(0, 100)}`);
  parts.push(`方法要点：${steps.slice(0, 260)}`);
  if (review) parts.push(`角色心法：${review.slice(0, 90)}`);

  return parts.join(' | ').slice(0, 500);
}

