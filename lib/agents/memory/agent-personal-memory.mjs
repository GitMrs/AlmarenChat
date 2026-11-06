import { rankMemoryRecords } from '../../memory/memory-recall.mjs';
import { normalizeMemoryType } from '../../memory/memory-taxonomy.mjs';

const LABELS = {
  stable_fact: '已知事实',
  preference: '偏好习惯',
  relationship: '关系记忆',
  decision: '已确认决策',
  rule: '交互准则',
  skill: '研习技能',
};

export function selectPersonalMemories(memories, query = '', limit = 6) {
  return rankMemoryRecords(memories, query, { limit, fields: ['category', 'content'] });
}

export function personalMemorySections(memories) {
  const facts = memories.filter(item => normalizeMemoryType(item.category) !== 'rule');
  const rules = memories.filter(item => normalizeMemoryType(item.category) === 'rule');
  const lines = items => items.map(item => `- [${LABELS[normalizeMemoryType(item.category)] || '已知事实'}] ${String(item.content).slice(0, 500)}`).join('\n');
  return [
    facts.length ? `【用户事实与偏好】\n${lines(facts)}` : '',
    rules.length ? `【用户确认的交互约定】\n${lines(rules)}` : '',
  ].filter(Boolean);
}

export function personalMemoryContext(memories, query) {
  const selected = selectPersonalMemories(memories, query);
  if (!selected.length) return '';
  return [
    '【当前 Agent 与该用户确认的个人记忆】',
    ...personalMemorySections(selected),
    '只在与当前问题直接相关时使用；不相关或不确定时忽略。私人对话原文不得自动公开，项目专属约定只在原场景适用。用户本轮指令优先。',
  ].join('\n');
}

export function buildSpaceExperience({ spaceId, sourceType, sourceId, topic, summary, entries, agentId }) {
  const own = entries.filter(entry => entry.agentId === agentId);
  if (!own.length || !sourceId) return null;
  const clean = (value, limit) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const others = [...new Set(entries.filter(entry => entry.agentId !== agentId).map(entry => entry.agentName || entry.agentId))];
  return {
    taskId: `${sourceType.toLowerCase()}:${spaceId}:${sourceId}`,
    sourceType,
    memoryTypes: ['episode'],
    memorySegments: [{
      source: 'space',
      type: 'episode',
      content: [
        `参与了空间活动：${clean(topic, 160) || '空间共同经历'}。`,
        `我的实际参与记录：${own.map(entry => clean(entry.content, 350)).join('；').slice(0, 700)}`,
        summary ? `当时记录的活动结论：${clean(summary, 700)}` : '',
        '讨论观点不是已核实的现实事实，游戏身份只在该局适用，空间规则不得推广到其他场景。',
      ].filter(Boolean).join('\n'),
    }],
    title: clean(topic, 160) || '空间共同经历',
    summary: [
      `我参与了空间活动：${clean(topic, 160)}。`,
      others.length ? `共同参与者：${others.join('、')}。` : '',
      `我的实际参与记录：${own.map(entry => clean(entry.content, 350)).join('；').slice(0, 700)}`,
      summary ? `当时记录的活动结论：${clean(summary, 700)}` : '',
      '这是当时的空间经历；讨论观点不是已核实的现实事实，游戏身份只在该局适用，空间规则不得推广到其他场景。',
    ].filter(Boolean).join('\n'),
  };
}
