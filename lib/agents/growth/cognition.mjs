// 判断只在自己的作用域内被替代；空间修正不能删除个人判断。
export function activeGrowthEvents(events) {
  const replaced = new Set(events.filter(e => e.type === 'REVISION').map(e => {
    const old = events.find(old => old.id === (e.payload?.supersedesEventId || e.payload?.previousEventId));
    return old && old.scope === e.scope && (old.spaceId || null) === (e.spaceId || null) ? old.id : null;
  }).filter(Boolean));
  return events.filter(e => !replaced.has(e.id));
}

export function validateCognition(input, events, evidenceIds) {
  if (!['BELIEF', 'REVISION', 'REFLECTION'].includes(input?.type)) throw new Error('认知事件类型无效');
  for (const key of ['title', 'content', 'beliefKey', 'behaviorChange']) {
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > (key === 'title' || key === 'beliefKey' ? 160 : 1200)) throw new Error(`认知记录缺少有效 ${key}`);
  }
  if (!Array.isArray(input.evidenceRefs) || !input.evidenceRefs.length || input.evidenceRefs.length > 8 || input.evidenceRefs.some(ref => ref?.type !== 'experience' || !evidenceIds.includes(ref?.id))) throw new Error('需要当前作用域内可验证的经历依据');
  if (input.type === 'BELIEF' && activeGrowthEvents(events).some(e => ['BELIEF', 'REVISION'].includes(e.type) && e.payload?.beliefKey === input.beliefKey)) throw new Error('同主题已有有效判断，请使用 REVISION 关联修正');
  if (input.type === 'REVISION') {
    const old = activeGrowthEvents(events).find(e => e.id === input.supersedesEventId && ['BELIEF', 'REVISION'].includes(e.type));
    if (!old || old.payload?.beliefKey !== input.beliefKey) throw new Error('修正必须关联同主题的有效旧判断');
  } else if (input.supersedesEventId) throw new Error('只有修正可以替代旧判断');
  return { title: input.title.trim(), content: input.content.trim(), beliefKey: input.beliefKey.trim(), behaviorChange: input.behaviorChange.trim(), evidenceRefs: input.evidenceRefs.map(ref => ({ type: 'experience', id: ref.id })), ...(input.type === 'REVISION' ? { supersedesEventId: input.supersedesEventId } : {}) };
}
