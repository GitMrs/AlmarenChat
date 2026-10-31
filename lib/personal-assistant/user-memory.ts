import { rankMemoryRecords, memoryCandidateWhere } from '@/lib/memory/memory-recall.mjs';
import prisma from '@/app/api/_lib/db';

export interface UserMemoryItem {
  category: string;
  content: string;
  updatedAt?: Date | string;
}

/** Shared relevance policy; private memory stores remain separate. */
export function selectRelevantUserMemories<T extends { category: string; content: string }>(memories: T[], query = '', limit = 6): T[] {
  return rankMemoryRecords(memories, query, { limit, fields: ['category', 'content'] });
}

export async function loadUserMemoryItems(userId: string, agentId?: string | null, limit = 40, query = '') {
  return prisma.assistantMemoryItem.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      AND: [memoryCandidateWhere(query, ['category', 'content'])],
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
