// 最新页仍以服务器为准，保留已加载且早于这一页的历史，避免轮询覆盖历史分页。
export function mergeMessagePage(current, incoming, prepend = false) {
  if (prepend) {
    const ids = new Set(current.map(message => message.id));
    return [...incoming.filter(message => !ids.has(message.id)), ...current];
  }
  if (!incoming.length) return [];
  const first = incoming[0];
  const ids = new Set(incoming.map(message => message.id));
  const boundary = Date.parse(first.createdAt);
  const older = current.filter(message => !ids.has(message.id) && (
    Date.parse(message.createdAt) < boundary
    || (Date.parse(message.createdAt) === boundary && message.id < first.id)
  ));
  return [...older, ...incoming];
}
