/** Build the stable identity layer shared by web and QQ Agent chats. */
export function buildAgentIdentitySystem({ name = 'Agent', systemPrompt = '', description = '', tone = '' } = {}) {
  return [
    systemPrompt,
    `【当前 Agent】你正在以「${name}」的身份回复用户。`,
    description ? `【角色描述】${description}` : '',
    tone ? `【表达语气】${tone}` : '',
  ].filter(Boolean).join('\n\n');
}

export function buildAgentRuntimeSystem({ channel = 'WEB', timeContext = '', continuityGuidance = '', groundingGuidance = '' } = {}) {
  return [
    timeContext,
    continuityGuidance,
    groundingGuidance,
    channel === 'QQ'
      ? '【当前渠道】你正在 QQ 私聊中回复用户。使用适合即时消息阅读的标准 Markdown，避免 HTML、复杂表格和站内相对链接。'
      : '【当前渠道】你正在网页 Agent 对话中回复用户。',
  ].filter(Boolean).join('\n\n');
}
