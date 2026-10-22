import { createHash } from 'node:crypto';

export const AGENT_MEMORY_CATEGORIES = {
  method: '工作方法',
  correction: '错误与纠正',
  capability: '能力经验',
};

const MAX_AGENT_MEMORY_CONTEXT_CHARS = 4_000;
const GENERIC_QUERY_TERMS = new Set([
  '帮我', '可以', '一下', '这个', '那个', '需要', '使用', '处理',
  '任务', '工作', '内容', '完成', '创建', '修改', '生成', '实现',
]);

function cleanText(value, limit = 2_000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function agentMemoryRuleKey(category, instruction) {
  const normalizedCategory = AGENT_MEMORY_CATEGORIES[category] ? category : 'method';
  return createHash('sha256')
    .update(`${normalizedCategory}:${cleanText(instruction, 1_200).toLocaleLowerCase()}`)
    .digest('hex')
    .slice(0, 24);
}

function queryTerms(value) {
  const text = cleanText(value, 4_000).toLocaleLowerCase();
  const compact = text.replace(/[^\p{L}\p{N}]+/gu, '');
  const terms = new Set(text.match(/[a-z0-9][a-z0-9._-]{1,}/g) || []);
  for (let index = 0; index < compact.length - 1 && terms.size < 64; index += 1) {
    terms.add(compact.slice(index, index + 2));
  }
  for (const term of GENERIC_QUERY_TERMS) terms.delete(term);
  return [...terms];
}

function relevanceScore(item, terms, index) {
  const source = `${item.title || ''} ${item.instruction || ''} ${item.summary || ''}`.toLocaleLowerCase();
  const matches = terms.reduce((score, term) => score + (source.includes(term) ? 1 : 0), 0);
  if (matches === 0) return 0;
  const correctionWeight = item.category === 'correction' ? 4 : 0;
  const evidenceWeight = Math.min(4, Math.max(0, Number(item.evidenceCount || 1) - 1));
  const recencyWeight = Math.max(0, 3 - Math.floor(index / 10));
  return matches * 5 + correctionWeight + evidenceWeight + recencyWeight;
}

export function selectAgentMemory({ rules = [], experiences = [], query = '', ruleLimit = 5, experienceLimit = 3 }) {
  const terms = queryTerms(query);
  const select = (items, limit) => items
    .map((item, index) => ({ item, score: relevanceScore(item, terms, index) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ item }) => item);
  const relevantExperiences = experiences.filter((item) => item.outcome === 'ACCEPTED' && (!item.status || item.status === 'ACTIVE'));
  const selectedExperiences = select(relevantExperiences, experienceLimit);
  return {
    rules: select(rules.filter((item) => item.status === 'ACTIVE'), ruleLimit),
    experiences: selectedExperiences.length || !/记得|上次|以前|经历|回忆|remember|last time/i.test(query)
      ? selectedExperiences : relevantExperiences.slice(0, experienceLimit),
  };
}

export function agentMemoryContext(input) {
  const selected = selectAgentMemory(input);
  if (selected.rules.length === 0 && selected.experiences.length === 0) return '';
  const sections = [
    '以下是当前用户的本 Agent 个人经历与已确认经验。只在与当前请求相关时采用；空间规则仅在来源空间适用，不得泄露其他空间原文或覆盖用户当前指令。',
  ];
  if (selected.rules.length > 0) {
    sections.push('已确认工作经验：\n' + selected.rules.map((item, index) => (
      `${index + 1}. [${AGENT_MEMORY_CATEGORIES[item.category] || '工作方法'}] ${cleanText(item.instruction, 1_200)}`
    )).join('\n'));
  }
  if (selected.experiences.length > 0) {
    sections.push('相关个人经历（含已完成的相关工作经历）：\n' + selected.experiences.map((item, index) => (
      `${index + 1}. [${item.sourceType || 'TASK'}${item.spaceId ? `；来源空间：${cleanText(item.spaceId, 100)}` : ''}${item.createdAt && Number.isFinite(new Date(item.createdAt).getTime()) ? `；记录时间：${new Date(item.createdAt).toISOString()}` : ''}] ${cleanText(item.title, 160)}：${cleanText(item.summary, 1_200)}`
    )).join('\n'));
  }
  return sections.join('\n\n').slice(0, MAX_AGENT_MEMORY_CONTEXT_CHARS);
}

export function correctionMemoryCandidate({ feedback, taskId, runId }) {
  const normalized = cleanText(feedback, 1_200);
  if (!normalized) return null;
  const instruction = `处理类似工作时必须落实这项用户纠正：${normalized}`;
  return {
    key: agentMemoryRuleKey('correction', instruction),
    category: 'correction',
    title: '落实用户确认的返工要求',
    instruction,
    sourceIds: [taskId, runId].filter(Boolean),
  };
}
