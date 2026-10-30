const ACTIVE_STATUSES = ['QUEUED', 'PLANNING', 'RUNNING', 'WAITING', 'WAITING_APPROVAL', 'SUMMARIZING', 'CANCEL_REQUESTED'];
export { ACTIVE_STATUSES as ACTIVE_PLATFORM_RUN_STATUSES };

export function platformContextRequest(message, allowedSources) {
  const text = String(message || '').trim();
  const tasks = /任务|执行记录|运行记录|工作流|成果|task|run\b/i.test(text);
  const spaces = /空间|项目|space|project/i.test(text);
  const chats = /(?:agent|角色|智能体|会话).{0,12}(?:聊天|对话|记录|聊过)|(?:聊天|对话|聊过).{0,12}(?:agent|角色|智能体)|会话记录|历史会话/i.test(text);
  const overview = /平台.{0,8}(?:概况|概览|状态)|(?:最近|今天).{0,8}(?:在平台|平台上).{0,8}(?:忙|做|干)/.test(text);
  const details = tasks && /失败|报错|错误|原因|详情|具体|卡住|超时|进度|进展/.test(text);
  const id = text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0];
  const quoted = text.match(/[“「"]([^”」"\n]{2,80})[”」"]/)?.[1];
  return {
    sources: {
      spaces: Boolean(allowedSources.spaces && (spaces || overview)),
      tasks: Boolean(allowedSources.tasks && (tasks || overview)),
      chats: Boolean(allowedSources.chats && (chats || overview)),
    },
    details,
    taskId: tasks ? id : undefined,
    taskSearch: tasks && !id ? quoted : undefined,
  };
}

export function compactPlatformText(value, maxChars) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

// Preserve complete JSON records and disclose omitted records instead of cutting JSON in half.
export function serializePlatformContext(data, maxChars = 6000) {
  const result = { ...data };
  const keys = Object.keys(result).filter((key) => Array.isArray(result[key]));
  for (const key of keys) result[key] = [...result[key]];
  let serialized = JSON.stringify(result);
  while (serialized.length > maxChars) {
    const key = keys.filter((key) => result[key].length).sort((a, b) => JSON.stringify(result[b].at(-1)).length - JSON.stringify(result[a].at(-1)).length)[0];
    if (!key) break;
    result[key].pop();
    result.omitted = { ...result.omitted, [key]: (result.omitted?.[key] || 0) + 1 };
    serialized = JSON.stringify(result);
  }
  return serialized;
}
