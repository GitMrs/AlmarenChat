export const askSpaceUser = {
  type: 'function',
  function: {
    name: 'ask_space_user',
    description: '当你判断用户的意思仍有影响下一步的歧义时，向用户提问并暂停成员接力。结合已有上下文，只问仍需澄清的部分。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['question'],
      properties: { question: { type: 'string', description: '直接发给用户的问题' } },
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
