const REFRESH_RESEARCH_PATTERNS = [
  /重新(?:联网|搜索|检索|查找|调研)/,
  /再(?:联网|搜索|检索|查一下|查找)/,
  /(?:刷新|更新|补充)(?:一下)?(?:联网)?(?:资料|来源|数据|搜索结果)/,
  /获取(?:一下)?最新(?:资料|来源|数据)/,
  /换(?:一批|个)?(?:资料|来源|搜索结果)/,
];

export function shouldRefreshResearch(feedback) {
  const text = typeof feedback === 'string' ? feedback.trim() : '';
  return Boolean(text && REFRESH_RESEARCH_PATTERNS.some((pattern) => pattern.test(text)));
}
