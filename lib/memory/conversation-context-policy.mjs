import { modelTokenLimits } from '../core/model-limits.mjs';

export const ASSISTANT_RECENT_MESSAGE_LIMIT = 60;
export const WORKING_SUMMARY_MAX_CHARS = 6000;
export const WORKING_SUMMARY_GUIDANCE = '【当前会话承接记录】以下仅用于恢复当前对话进度。保留来源及当时时间；助理提议不代表用户确认，过去状态不自动延续到现在，较新用户指令优先。摘要可能省略细节，必要时回查原文。';

export function estimateContextTokens(value) {
  if (typeof value === 'string') {
    const chinese = (value.match(/[\u4e00-\u9fff]/g) || []).length;
    return Math.ceil(chinese / 1.5 + (value.length - chinese) / 4);
  }
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + estimateContextTokens(item), 0);
  if (value?.type === 'image_url') return 4096; // conservative estimate; provider/image dependent
  if (value && typeof value === 'object') return estimateContextTokens(JSON.stringify(value));
  return 0;
}
export function estimateRequestTokens(messages, tools = []) {
  return messages.reduce((sum, message) => sum + estimateContextTokens(message.content) + estimateContextTokens(message.tool_calls || []) + 20, 0) + estimateContextTokens(tools);
}
export function conversationBudget(modelName, configuredContextWindow) {
  const limits = modelTokenLimits(modelName, configuredContextWindow);
  const hardInputBudget = limits.contextWindow - limits.maxTokens;
  const toolReserve = Math.min(16_000, limits.maxTokens);
  return {
    inputBudget: Math.min(limits.compactionTriggerTokens, hardInputBudget - toolReserve),
    toolReserve,
    hardInputBudget: limits.contextWindow - limits.maxTokens,
    contextWindow: limits.contextWindow,
    replyReserve: limits.maxTokens,
  };
}
export function continuousRecentSuffix(history, maxMessages, tokenBudget = Infinity) {
  const count = Math.max(1, Math.min(80, Math.floor(Number(maxMessages) || 40)));
  let recent = history.slice(-count);
  // Keep a complete opening user turn when possible. A one-message setting can
  // retain the last assistant reply because its question is carried by the bridge.
  if (recent[0]?.role === 'assistant' && recent.some(message => message.role === 'user')) recent = recent.slice(recent.findIndex(message => message.role === 'user'));
  while (recent.length && estimateRequestTokens(recent) > tokenBudget) {
    if (recent.length === 1) throw new Error('最近一条消息已超出上下文预算，请缩短输入或提高已确认的模型窗口配置');
    let next = recent.findIndex((message, index) => index > 0 && message.role === 'user');
    if (next < 0) next = recent.length - 1;
    recent = recent.slice(next);
  }
  return recent;
}
export function composeConversationRequest({ requiredSystem = '', summary = '', recent = [], currentMessage, optional = [], budget }) {
  const system = [requiredSystem, summary ? `${WORKING_SUMMARY_GUIDANCE}\n${summary}` : ''].filter(Boolean).join('\n\n');
  const messages = [...(system ? [{ role: 'system', content: system }] : []), ...recent.map(({ role, content }) => ({ role, content })), currentMessage];
  if (estimateRequestTokens(messages) > budget) return null;
  const included = [];
  const omitted = [];
  for (const part of optional) {
    if (!part.content) continue;
    const extra = { role: 'system', content: part.content };
    if (estimateRequestTokens([...messages, extra]) <= budget) {
      messages.splice(messages.findIndex(message => message.role !== 'system'), 0, extra);
      included.push(part.name);
    } else omitted.push(part.name);
  }
  if (omitted.length) {
    messages.splice(messages.findIndex(message => message.role !== 'system'), 0, {
      role: 'system', content: `【本轮预算说明】以下资料未加入本轮上下文：${omitted.join('、')}。不能声称已经读取；需要时用工具查询或明确说明缺失，不要补写。`,
    });
  }
  if (estimateRequestTokens(messages) > budget) return null;
  return { messages, included, omitted, estimatedInputTokens: estimateRequestTokens(messages) };
}
export function quotedWorkingSummary(previous, pending) {
  const lines = pending.map(message => {
    const content = String(message.content || '').trim();
    const quoted = content.length <= 1600 ? content : `${content.slice(0, 800)}\n[原消息中段省略，需回查]\n${content.slice(-800)}`;
    return `[${new Date(message.createdAt).toISOString()}，${message.role === 'user' ? '用户原话' : '助理原话，尚未独立核实'}，ID:${message.id}]\n${quoted}`;
  });
  return [previous, ...lines].filter(Boolean).join('\n\n');
}
export function extractiveWorkingSummary(text) {
  // Local mode: preserve whole labelled excerpts, never claim omitted details survived.
  const blocks = String(text).split(/\n\n(?=\[\d{4}-)/u)
    .flatMap(block => block.startsWith('【当前目标】') ? block.split(/\n(?=【)/u) : [block]);
  const ranked = blocks.map((block, index) => ({ block, index,
    priority: index >= blocks.length - 2 ? 100
      : /用户原话/u.test(block) && /不要|禁止|必须|目标|决定|确认|取消|别改|只.{0,8}(?:讨论|分析|规划)|先.{0,8}(?:规划|讨论)/u.test(block) ? 90
        : /^(?:【当前目标】|【用户已确认】|【进度与取消】)/u.test(block) ? 80 : 0,
  })).sort((a, b) => b.priority - a.priority || b.index - a.index);
  const selected = [];
  let used = 150;
  for (const item of ranked) {
    if (used + item.block.length > WORKING_SUMMARY_MAX_CHARS) continue;
    selected.push(item); used += item.block.length;
  }
  selected.sort((a, b) => a.index - b.index);
  return `【摘录式承接，较早细节可能省略，请按消息ID回查；不代表全部事项已确认】\n${selected.map(item => item.block).join('\n\n')}`;
}
