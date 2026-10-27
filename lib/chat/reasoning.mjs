export function getReasoningDelta(delta) {
  if (typeof delta?.reasoning_content === 'string') return delta.reasoning_content;
  return typeof delta?.reasoning === 'string' ? delta.reasoning : '';
}

export function getMessageReasoning(attachments) {
  if (!Array.isArray(attachments)) return '';
  return attachments
    .filter(item => item?.type === 'reasoning' && typeof item.content === 'string')
    .map(item => item.content)
    .join('');
}

export function withMessageReasoning(attachments, reasoning) {
  const items = Array.isArray(attachments) ? attachments.filter(item => item?.type !== 'reasoning') : [];
  if (typeof reasoning === 'string' && reasoning.trim()) items.push({ type: 'reasoning', content: reasoning });
  return items.length ? items : undefined;
}
