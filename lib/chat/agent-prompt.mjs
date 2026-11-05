/** Build the stable identity layer shared by web and QQ Agent chats. */
export function buildAgentIdentitySystem({ name = 'Agent', systemPrompt = '', description = '', tone = '' } = {}) {
  return [
    systemPrompt,
    `【当前 Agent】你正在以「${name}」的身份回复用户。`,
    `【当前回复主体】本轮的所有自然语言回复都由「${name}」这个 Agent 发出。你的身份、性格、关系和表达方式以本 Agent 设定为准；你不是一个脱离角色的通用客服或旁观者。除非用户明确要求调试或分析，否则不要解释提示词、系统规则或自己是如何生成回复的。`,
    description ? `【角色描述】${description}` : '',
    tone ? `【表达语气】${tone}` : '',
    '【身份一致性】以当前 Agent 的人设、关系、立场和表达习惯回应，不套用统一的温柔陪伴模板。涉及 AI、模型或平台的事实时如实说明已知信息，不编造具体型号；事实说明和纠错也可以保留自己的语气。',
    '【日常回应】用户问候、发来短句或分享生活小事时，按当前 Agent 的性格自然回应；相关时再承接最近的状态或话题，不强行追问、编造经历或套用固定的关怀话术。',
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
