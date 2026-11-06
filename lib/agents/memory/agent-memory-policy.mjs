import { rankMemoryRecords, isBroadMemoryRecall, recallExperiences } from '../../memory/memory-recall.mjs';
import { createHash } from 'node:crypto';

export const AGENT_MEMORY_CATEGORIES = {
  method: '工作方法',
  correction: '错误与纠正',
  capability: '能力经验',
};

const MAX_AGENT_MEMORY_CONTEXT_CHARS = 4_000;
function cleanText(value, limit = 2_000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

/** @param {{ scope?: unknown, spaceId?: unknown, taskId?: unknown }} [input] */
export function agentMemoryRuleScope({ scope = 'AGENT', spaceId, taskId } = {}) {
  if (!['AGENT', 'SPACE', 'TASK'].includes(scope)) throw new Error('无效的规则适用范围');
  const space = cleanText(spaceId, 200) || null;
  const task = cleanText(taskId, 200) || null;
  if (scope !== 'AGENT' && !space) throw new Error('空间或任务规则必须指定来源空间');
  if (scope === 'TASK' && !task) throw new Error('任务规则必须指定来源任务');
  return { scope: String(scope), spaceId: scope === 'AGENT' ? null : space, taskId: scope === 'TASK' ? task : null };
}

export function agentMemoryRuleWhere({ spaceId = null, taskId = null } = {}) {
  return { OR: [
    { scope: 'AGENT', spaceId: null, taskId: null },
    ...(spaceId ? [{ scope: 'SPACE', spaceId, taskId: null }] : []),
    ...(spaceId && taskId ? [{ scope: 'TASK', spaceId, taskId }] : []),
  ] };
}

export function agentMemoryRuleApplies(rule, context) {
  return agentMemoryRuleWhere(context).OR.some(scope => Object.entries(scope).every(([key, value]) => (rule[key] ?? (key === 'scope' ? 'AGENT' : null)) === value));
}

export function agentMemoryRuleKey(category, instruction, scope = {}) {
  const normalizedCategory = AGENT_MEMORY_CATEGORIES[category] ? category : 'method';
  const normalizedScope = agentMemoryRuleScope(scope);
  const suffix = normalizedScope.scope === 'AGENT' ? '' : `:${normalizedScope.scope}:${normalizedScope.spaceId}:${normalizedScope.taskId || ''}`;
  return createHash('sha256')
    .update(`${normalizedCategory}:${cleanText(instruction, 1_200).toLocaleLowerCase()}${suffix}`)
    .digest('hex')
    .slice(0, 24);
}

export function selectAgentMemory({ rules = [], experiences = [], query = '', ruleLimit = 5, experienceLimit = 3, spaceId = null, taskId = null }) {
  const relevantExperiences = experiences.filter((item) => item.outcome === 'ACCEPTED' && (!item.status || item.status === 'ACTIVE') && (!item.spaceId || item.spaceId === spaceId) && !(spaceId && item.sourceType === 'CHAT'));
  const asksAboutStudy = /学了什么|学过什么|学习了什么|研习了什么|读了什么|看了什么|最近.*学习|今天.*学习/i.test(query);
  const candidates = asksAboutStudy ? relevantExperiences.filter(item => item.sourceType === 'STUDY') : relevantExperiences;
  const chats = recallExperiences(candidates.filter(item => item.sourceType === 'CHAT'), query).items;
  const others = rankMemoryRecords(candidates.filter(item => item.sourceType !== 'CHAT'), query, { limit: experienceLimit, broad: isBroadMemoryRecall(query) });
  const selectedExperiences = [...chats, ...others].slice(0, experienceLimit);
  return {
    rules: rankMemoryRecords(rules.filter((item) => item.status === 'ACTIVE' && agentMemoryRuleApplies(item, { spaceId, taskId })), query, { limit: ruleLimit }),
    experiences: selectedExperiences,
  };
}

export function agentMemoryContext(input) {
  const selected = selectAgentMemory(input);
  if (selected.rules.length === 0 && selected.experiences.length === 0) return '';
  const sections = [
    '以下是当前用户的本 Agent 活动记录、对话归档与已确认工作经验。活动和归档用于回忆，不是用户偏好或已核实的外部知识；学习方法与资料以知识库检索结果为准。空间规则仅在来源空间适用，不得泄露其他空间原文或覆盖用户当前指令。',
  ];
  if (selected.rules.length > 0) {
    sections.push('已确认工作经验：\n' + selected.rules.map((item, index) => (
      `${index + 1}. [${AGENT_MEMORY_CATEGORIES[item.category] || '工作方法'}；${item.scope === 'TASK' ? '仅当前任务' : item.scope === 'SPACE' ? '仅当前空间' : '当前 Agent'}] ${cleanText(item.instruction, 1_200)}`
    )).join('\n'));
  }
  if (selected.experiences.length > 0) {
    sections.push('相关个人经历（含已完成的相关工作经历）：\n' + selected.experiences.map((item, index) => (
      `${index + 1}. [${item.sourceType || 'TASK'}${item.spaceId ? `；来源空间：${cleanText(item.spaceId, 100)}` : ''}${item.createdAt && Number.isFinite(new Date(item.createdAt).getTime()) ? `；记录时间：${new Date(item.createdAt).toISOString()}` : ''}] ${cleanText(item.title, 160)}：${item.sourceType === 'CHAT' ? `[记忆存档ID：${item.id}] ${item.matchedSummary}` : cleanText(item.summary, 1_200)}`
    )).join('\n'));
  }
  return sections.join('\n\n').slice(0, MAX_AGENT_MEMORY_CONTEXT_CHARS);
}

export function correctionMemoryCandidate({ feedback, taskId, runId, spaceId }) {
  const normalized = cleanText(feedback, 1_200);
  if (!normalized || !taskId || !spaceId) return null;
  const scope = agentMemoryRuleScope({ scope: 'TASK', taskId, spaceId });
  const instruction = `处理类似工作时必须落实这项用户纠正：${normalized}`;
  return {
    key: agentMemoryRuleKey('correction', instruction, scope),
    ...scope,
    category: 'correction',
    title: '待确认的任务返工经验',
    instruction,
    sourceIds: [taskId, runId].filter(Boolean),
  };
}
