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
  return `\n\n_查询状态：${parts.length ? parts.join('；') : '本轮未进行联网搜索或外部数据查询'}。_`;
}
