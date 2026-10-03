import prisma from '@/app/api/_lib/db';

export interface UserMemoryItem {
  category: string;
  content: string;
  updatedAt?: Date | string;
}

const GENERIC_QUERY_TERMS = new Set([
  '帮我', '可以', '一下', '这个', '那个', '需要', '使用', '处理',
  '任务', '工作', '内容', '完成', '创建', '修改', '生成', '实现', '怎么', '什么', '如何',
  '请问', '给我', '看看', '觉得', '怎样', '问题', '开始',
]);

function extractSearchTerms(query: string): string[] {
  const text = String(query || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const terms = new Set<string>();

  // 提取英文单词及数字（如 ts, nextjs, react, python, api 等）
  const alphaMatches = text.match(/[a-z0-9][a-z0-9._-]{1,}/g) || [];
  for (const match of alphaMatches) {
    terms.add(match);
  }

  // 提取中文双字二元分词 (bi-grams)
  const compactChinese = text.replace(/[^\u4e00-\u9fa5]/gu, '');
  for (let i = 0; i < compactChinese.length - 1 && terms.size < 60; i += 1) {
    const bi = compactChinese.slice(i, i + 2);
    if (!GENERIC_QUERY_TERMS.has(bi)) {
      terms.add(bi);
    }
  }

  return [...terms];
}

/**
 * 根据用户当前输入，从该 Agent 专属记忆库中精准挑选最相关的记忆条目（避免全部硬塞导致上下文臃肿）
 */
export function selectRelevantUserMemories<T extends { category: string; content: string }>(
  memories: T[],
  query?: string,
  limit = 6
): T[] {
  if (!memories.length) return [];
  if (!query || !query.trim()) return memories.slice(0, Math.min(limit, 4));

  const terms = extractSearchTerms(query);
  if (!terms.length) return memories.slice(0, Math.min(limit, 4));

  const scored = memories.map((memory, index) => {
    const text = `${memory.category} ${memory.content}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (text.includes(term)) {
        score += term.length >= 3 ? 5 : 2;
      }
    }
    // 越新保存的记忆赋予微小时间权重
    score += Math.max(0, 1 - index * 0.05);
    return { memory, score };
  });

  // 命中关键词的记忆优先排在最前
  const matches = scored.filter((item) => item.score > 1).sort((a, b) => b.score - a.score);
  if (matches.length > 0) {
    return matches.slice(0, limit).map((item) => item.memory);
  }

  // 若无强相关词命中，选取前 3 条最新核心偏好作为兜底认知
  return memories.slice(0, Math.min(limit, 3));
}

export async function loadUserMemoryItems(userId: string, agentId?: string | null, limit = 40) {
  return prisma.assistantMemoryItem.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      ...(agentId ? { agentId } : { agentId: null }),
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { category: true, content: true },
  });
}

const CATEGORY_LABELS: Record<string, string> = {
  preference: '偏好习惯',
  tech: '技术选型',
  rule: '交互准则',
  project: '项目背景',
  fact: '已知事实',
};

/**
 * 将检索出的记忆转化为具有“老搭档默契”的 Agent 伙伴心智 System Prompt
 */
export function buildUserMemoryContext(
  memories: Array<{ category: string; content: string }>,
  query?: string
) {
  if (memories.length === 0) return '';
  const selected = selectRelevantUserMemories(memories, query, 6);
  if (selected.length === 0) return '';

  const memoryLines = selected.map((m) => {
    const label = CATEGORY_LABELS[m.category] || m.category || '已知事实';
    return `- [${label}] ${m.content}`;
  }).join('\n');

  return [
    '【你与该用户积累的专属认知与长期记忆】：',
    memoryLines,
    '',
    '【运用准则】：',
    '以上是你与该用户在过往相处中沉淀的长期认知。请将其作为回答的默认前提，自然顺应其偏好；除非用户主动问起或确认，无需刻意声明“我查了记忆库”或生硬背诵这些偏好。',
  ].join('\n');
}
