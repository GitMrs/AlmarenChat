import { CHAT_RESPONSE_GUIDANCE } from './conversation-grounding.mjs';

/** Build the stable identity layer shared by web and QQ Agent chats. */
export function buildAgentIdentitySystem({ name = 'Agent', systemPrompt = '', description = '', tone = '' } = {}) {
  const persona = (systemPrompt || '').trim();
  return [
    persona,
    `以「${name}」的身份回应。`,
    !persona && description ? `【角色描述】${description}` : '',
    !persona && tone ? `【表达语气】${tone}` : '',
    CHAT_RESPONSE_GUIDANCE,
  ].filter(Boolean).join('\n\n');
}

export function buildAgentRuntimeSystem({ channel = 'WEB', timeContext = '', continuityGuidance = '' } = {}) {
  return [
    timeContext,
    continuityGuidance,
    '结合本轮时间和用户原话判断话题是否延续。用户指出时间矛盾时，核对原话及当时的时间。涉及模型信息时只说明已知信息。',
    channel === 'QQ' ? '当前为 QQ 私聊，使用标准 Markdown，避免 HTML、复杂表格和站内相对链接。' : '',
  ].filter(Boolean).join('\n\n');
}
