export const askSpaceUser = {
  type: 'function',
  function: {
    name: 'ask_space_user',
    description: '下一步缺少只有用户能确认的信息时，选用此工具，本轮不邀请或 @ 其他成员。先用正文回答能确认的部分，工具会在末尾附上问题。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['question'],
      properties: { question: { type: 'string', description: '只填写还需要用户回答的问题' } },
    },
  },
};

// Only an explicit closing handoff can enqueue a peer. Clarification wins
// even if the question quotes a handoff from the user's message.
export function closingHandoff(content, awaitingUser) {
  if (awaitingUser) return '';
  const lastLine = content.trim().split('\n').pop()?.trim() || '';
  return lastLine.startsWith('@') ? lastLine : '';
}

export function omitPendingHandoffs(tail, isMemberMention) {
  return tail.split('\n').filter(line => !line.trimStart().startsWith('@') || !isMemberMention(line)).join('\n');
}
