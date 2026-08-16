const EXPLICIT_WEB_RESEARCH_PATTERN = /(?:联网|网上搜索|网络搜索|搜索|检索|调研|收集资料|查找资料|最新|市场调研|竞品(?:分析|调研)?|research)/i;
const SOURCED_RESEARCH_PATTERN = /(?:资料|数据|事实|结论|信息).{0,12}(?:来源|引用)|(?:标注|提供|附上|列出|补充).{0,12}(?:来源|引用|链接|网址)|(?:来源|引用).{0,12}(?:链接|网址|url|资料|数据|文献|论文|官网|官方)/i;
const NEGATED_RESEARCH_PATTERN = /(?:无需|不需要|不用|不要|不得|禁止|不允许|不必|避免|不(?:进行|使用|启用|访问)?)(?:(?!但|但是|不过|然而|仍需|还需|同时需要).){0,18}(?:联网|网上搜索|网络搜索|搜索|检索|调研|收集资料|查找资料|最新|市场调研|竞品|research|来源|引用|链接|网址)/i;
const LOCAL_SEARCH_UI_PATTERN = /(?:商品|订单|列表|内容|名称|关键词|站内|本地).{0,8}搜索|搜索(?:框|栏|功能|交互|按钮|筛选)|搜索.{0,24}(?:筛选|列表|表单|新增|页面|交互|实时过滤)|(?:页面|应用).{0,24}(?:搜索|实时过滤)/i;
const WEB_SEARCH_QUALIFIER_PATTERN = /(?:联网|网上|网络|互联网|网页|全网|外部资料|新闻|官网|官方来源|实时数据|最新|research)/i;
const CONTRAST_PATTERN = /(?=但(?:是)?|不过|然而|仍需|还需|同时需要)/g;

export function needsWebResearch(value) {
  const clauses = String(value || '')
    .replace(CONTRAST_PATTERN, '\n')
    .split(/[，,；;。！？!?\n]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);

  return clauses.some((clause) => {
    if (NEGATED_RESEARCH_PATTERN.test(clause)) return false;
    if (LOCAL_SEARCH_UI_PATTERN.test(clause) && !WEB_SEARCH_QUALIFIER_PATTERN.test(clause)) return false;
    return EXPLICIT_WEB_RESEARCH_PATTERN.test(clause) || SOURCED_RESEARCH_PATTERN.test(clause);
  });
}
