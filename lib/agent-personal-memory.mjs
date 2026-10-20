const LABELS = { preference: '偏好习惯', tech: '技术选型', rule: '交互准则', project: '项目背景', fact: '已知事实' };

export function selectPersonalMemories(memories, query = '', limit = 6) {
  const text = String(query).trim().toLowerCase();
  const terms = new Set(text.match(/[a-z0-9][a-z0-9._-]{1,}/g) || []);
  const chinese = text.replace(/[^\u4e00-\u9fff]/g, '');
  for (let i = 0; i < chinese.length - 1 && terms.size < 64; i++) terms.add(chinese.slice(i, i + 2));
  const active = memories.filter(item => !item.status || item.status === 'ACTIVE');
  const matches = active.map((item, index) => ({ item, index, score: [...terms].filter(term => `${item.category} ${item.content}`.toLowerCase().includes(term)).length }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  return matches.length ? matches.slice(0, limit).map(item => item.item) : active.slice(0, 3);
}

export function personalMemoryContext(memories, query) {
  const selected = selectPersonalMemories(memories, query);
  if (!selected.length) return '';
  return [
    '【当前 Agent 与该用户确认的个人记忆】',
    ...selected.map(item => `- [${LABELS[item.category] || '已知事实'}] ${String(item.content).slice(0, 500)}`),
    '按相关性自然使用；私人对话原文不得自动公开，项目专属约定只在原场景适用。用户本轮指令优先。',
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
