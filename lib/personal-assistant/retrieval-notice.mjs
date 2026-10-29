export function stripRetrievalNotices(content) {
  let text = String(content || '').trimEnd();
  const trailingNotice = /(?:^|\r?\n)[ \t]*(?:>[ \t]*)?(?:[-*][ \t]+)?[*_]{0,2}[ \t]*查询状态[：:][^\r\n]*$/u;
  while (trailingNotice.test(text)) text = text.replace(trailingNotice, '').trimEnd();
  return text;
}

// 仅用于模型历史；展示和持久化仍保留完整来源。
export function stripHistoryRetrievalNotices(content) {
  const original = String(content || '');
  let text = original.trimEnd();
  const interrupted = text.match(/\r?\n\r?\n_回复已中止_$/u)?.[0] || '';
  if (interrupted) text = text.slice(0, -interrupted.length);
  const withoutStatus = stripRetrievalNotices(text);
  let changed = withoutStatus !== text;
  text = withoutStatus;
  const footer = /\r?\n\r?\n---\r?\n(?:\*\*查询来源\*\*（查询时间：\d{4}-\d{2}-\d{2}T[\d:.]+Z）\r?\n\r?\n\d+\. \[[^\r\n]*\]\(<[^<>\r\n]+>\)(?:（数据时间：[^\r\n]*）)?(?:\r?\n\d+\. \[[^\r\n]*\]\(<[^<>\r\n]+>\)(?:（数据时间：[^\r\n]*）)?)*|本轮查询未取得可引用来源。)(?:\r?\n\r?\n_缓存说明：[^\r\n]*。_)?(?:\r?\n\r?\n_部分联网查询失败，未取得可靠资料。_)?(?:\r?\n\r?\n_部分平台未返回数据，以上仅包含可用来源。_)?$/u;
  const match = footer.exec(text);
  if (match) {
    let fence = null;
    for (const line of text.slice(0, match.index).split(/\r?\n/)) {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
      if (!marker) continue;
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
    }
    if (!fence) {
      text = text.slice(0, match.index).trimEnd();
      changed = true;
    }
  }
  return changed ? text + interrupted : original;
}

export function stripLeadingHistoryTimestampMetadata(content) {
  let text = String(content || '');
  const token = /[\[【]\s*历史消息时间\s*[:：]\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?\s*[,，]?\s*北京时间\s*[\]】]/gu;
  return text.replace(token, '').replace(/^\s+/, '');
}

export function buildRetrievalNotice({ weatherStatus = '', searched = false, webpage = false, crypto = false, trending = false, toolCalled = false } = {}) {
  const parts = [];
  if (weatherStatus === 'success') parts.push('天气来源：和风天气（平台查询，可能使用缓存）');
  if (weatherStatus === 'waiting') parts.push('天气查询：等待确认地区，尚未获取天气数据');
  if (weatherStatus === 'failed') parts.push('天气查询：本轮处理失败，未获取可靠天气数据');
  if (searched) parts.push('本轮已执行联网搜索，检索结果及来源见正文');
  if (webpage) parts.push('本轮已请求读取网页，读取结果见正文');
  if (crypto) parts.push('本轮已处理平台行情查询，结果见正文（可能使用缓存）');
  if (trending) parts.push('本轮已读取平台热榜（可能使用缓存）');
  if (toolCalled) parts.push('本轮已调用外部工具，是否访问网络以工具结果为准');
  return parts.length ? `\n\n_查询状态：${parts.join('；')}。_` : '';
}
