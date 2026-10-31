import { rankMemoryRecords } from '../../memory/memory-recall.mjs';
const LABELS = { preference: '偏好习惯', tech: '技术选型', rule: '交互准则', project: '项目背景', fact: '已知事实', skill: '研习技能' };

export function selectPersonalMemories(memories, query = '', limit = 6) {
  return rankMemoryRecords(memories, query, { limit, fields: ['category', 'content'] });
}

export function personalMemoryContext(memories, query) {
  const selected = selectPersonalMemories(memories, query);
  if (!selected.length) return '';
  return [
    '【当前 Agent 与该用户确认的个人记忆】',
    ...selected.map(item => `- [${LABELS[item.category] || '已知事实'}] ${String(item.content).slice(0, 500)}`),
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
