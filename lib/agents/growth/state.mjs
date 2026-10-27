const STAGES = [
  { stage: 1, name: '认识世界' },
  { stage: 2, name: '形成判断' },
  { stage: 3, name: '主动修正' },
  { stage: 4, name: '持续整合' },
];

function eventPayload(event) {
  return event?.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? event.payload
    : {};
}

/**
 * 从成长事件派生当前状态。事件本身是唯一历史来源，状态只是可重算的视图。
 */
export function deriveAgentGrowthState(events = [], now = Date.now()) {
  const ordered = [...events]
    .filter((event) => event && event.createdAt)
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  const counts = {};
  for (const event of ordered) {
    const type = String(event.type || 'UNKNOWN').toUpperCase();
    counts[type] = (counts[type] || 0) + 1;
  }

  const hasBelief = (counts.BELIEF || 0) > 0;
  const hasRevision = (counts.REVISION || 0) > 0;
  const hasReflection = (counts.REFLECTION || 0) > 0;
  const stage = hasRevision && hasReflection ? 4 : hasRevision ? 3 : hasBelief ? 2 : 1;
  const firstAt = ordered.length ? new Date(ordered[0].createdAt).getTime() : null;
  const days = firstAt == null ? 0 : Math.max(1, Math.floor((Number(now) - firstAt) / 86_400_000) + 1);
  const stageInfo = STAGES[stage - 1];

  const recent = (type) => ordered
    .filter((event) => String(event.type || '').toUpperCase() === type)
    .slice(-5)
    .reverse()
    .map((event) => {
      const payload = eventPayload(event);
      return {
        title: String(payload.title || payload.topic || type).trim().slice(0, 160),
        content: String(payload.content || payload.summary || payload.thoughts || '').trim().slice(0, 500),
        createdAt: new Date(event.createdAt).toISOString(),
      };
    });

  return {
    stage,
    stageName: stageInfo.name,
    days,
    eventCount: ordered.length,
    counts,
    recentBeliefs: recent('BELIEF'),
    recentRevisions: recent('REVISION'),
    recentReflections: recent('REFLECTION'),
  };
}

export function formatAgentGrowthState(state) {
  if (!state || !state.eventCount) return '';
  const count = (type) => Number(state.counts?.[type] || 0);
  return [
    `当前成长阶段：第 ${state.stage} 阶段「${state.stageName}」，已记录 ${state.days} 天、${state.eventCount} 次经历。`,
    `判断 ${count('BELIEF')} 次，修正 ${count('REVISION')} 次，反思 ${count('REFLECTION')} 次，拒绝 ${count('REFUSAL')} 次。`,
  ].join('\n');
}
