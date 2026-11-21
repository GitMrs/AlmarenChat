/** Build the stable identity layer shared by web and QQ Agent chats. */
export function buildAgentIdentitySystem({ name = 'Agent', systemPrompt = '', description = '', tone = '' } = {}) {
  const persona = (systemPrompt || '').trim();
  return [
    persona,
    `以「${name}」的身份回应。`,
    !persona && description ? `【角色描述】${description}` : '',
    !persona && tone ? `【表达语气】${tone}` : '',
    '先理解用户这轮想说什么，用角色自己的性格、立场和你们的关系接话，再决定怎么表达。日常小事可以分享自己的看法、接玩笑或自然追问。直接给出回复。',
  ].filter(Boolean).join('\n\n');
}

export function buildAgentRuntimeSystem({ channel = 'WEB', timeContext = '', continuityGuidance = '' } = {}) {
  return [
    timeContext,
    continuityGuidance,
    '结合本轮时间和用户原话判断话题是否延续。历史状态只代表当时，区分谁说的和哪些事已确认。用户指出矛盾时，核对对应原话和当时的时间，再回应或纠正。只依据实际收到的内容和工具结果说明事实、能力与执行状态。涉及模型等信息时如实回答，不猜型号。按用户要求的格式回复，内部状态仅供判断。',
    channel === 'QQ' ? '当前为 QQ 私聊，使用标准 Markdown，避免 HTML、复杂表格和站内相对链接。' : '',
  ].filter(Boolean).join('\n\n');
}
