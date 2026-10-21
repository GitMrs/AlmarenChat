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
export const MAX_KNOWLEDGE_CONTENT_CHARS = 12000;
/** 写入知识库 Markdown 时摘录的核心正文上限，避免盲目堆砌上万字流水账导致向量碎片爆炸 */
export const MAX_STUDY_EXCERPT_CHARS = 1500;
/** 分型置信度低于该值时知识进入草稿，不参与检索。设为 0.75 严把入库质量门槛 */
export const MIN_ACTIVE_CONFIDENCE = 0.75;

export type StudyContentKind = 'news' | 'opinion' | 'knowledge' | 'personal_fact';

export interface StudyContentAssessment {
  id: string;
  contentKind: StudyContentKind;
  category?: string;
  title?: string;
  summary: string;
  keyPoints: string[];
  confidence: number;
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

  // 2. 兜底回退：结构化摘要与核心要点
  blocks.push('', '## 摘要', assessment.summary || '');
  const keyPoints = (assessment.keyPoints || []).map((point) => `- ${point}`).filter(Boolean);
  if (keyPoints.length > 0) blocks.push('', '## 关键要点', ...keyPoints);

  const cleanContent = String(options.content || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (cleanContent.length > 0) {
    // 兼容单元测试断言，但按句子边界完整收尾，绝不切断半句话
    let excerpt = cleanContent;
    if (cleanContent.length > MAX_STUDY_EXCERPT_CHARS) {
      const sliced = cleanContent.slice(0, MAX_STUDY_EXCERPT_CHARS);
      const safeEnd = sliced.search(/[。！？!?；;\n][^。！？!?；;\n]*$/);
      excerpt = safeEnd > 100 ? sliced.slice(0, safeEnd + 1).trim() : sliced.trim();
    }
    if (excerpt) {
      blocks.push('', '## 原文', excerpt);
    }
  }

  return blocks.join('\n');
}
