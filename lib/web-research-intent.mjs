const EXPLICIT_WEB_RESEARCH_PATTERN = /(?:联网|网上搜索|网络搜索|搜索|检索|调研|收集资料|查找资料|最新|市场调研|竞品(?:分析|调研)?|research)/i;
const SOURCED_RESEARCH_PATTERN = /(?:资料|数据|事实|结论|信息).{0,12}(?:来源|引用)|(?:标注|提供|附上|列出|补充).{0,12}(?:来源|引用|链接|网址)|(?:来源|引用).{0,12}(?:链接|网址|url|资料|数据|文献|论文|官网|官方)/i;
const NEGATED_RESEARCH_PATTERN = /(?:无(?:需|须|任何)?|无需|不需要|不用|不要|不得|禁止|不允许|不必|避免|仅(?:使用|基于).{0,12}(?:已有|现有|给定|本地)|离线(?:完成|处理|运行)?|不(?:进行|使用|启用|访问|涉及|引入)?)(?:(?!但|但是|不过|然而|仍需|还需|同时需要).){0,18}(?:联网|网上搜索|网络搜索|搜索|检索|调研|收集资料|查找资料|外部(?:资料|链接|内容|资源)?|最新|市场调研|竞品|research|来源|引用|链接|网址)/i;
const LOCAL_SEARCH_UI_PATTERN = /(?:商品|订单|列表|内容|名称|关键词|站内|本地).{0,8}搜索|搜索(?:框|栏|功能|交互|按钮|筛选)|搜索.{0,24}(?:筛选|列表|表单|新增|页面|交互|实时过滤)|(?:页面|应用).{0,24}(?:搜索|实时过滤)/i;
const LOCAL_WORKSPACE_SEARCH_PATTERN = /(?:查询|查看|列出|浏览|搜索|检索|查找).{0,16}(?:当前|本地|空间|项目)?(?:目录|文件|工作区|仓库)|(?:当前|本地|空间|项目)?(?:目录|文件|工作区|仓库).{0,16}(?:查询|查看|列出|浏览|搜索|检索|查找)/i;
const WEB_SEARCH_QUALIFIER_PATTERN = /(?:联网|网上|网络|互联网|网页|全网|外部资料|新闻|官网|官方来源|实时数据|最新|research)/i;
const EXPLICIT_REMOTE_QUALIFIER_PATTERN = /(?:联网|网上|网络|互联网|网页|全网|外部资料|新闻|官网|官方来源|research)/i;
const EXISTING_RESEARCH_MATERIAL_PATTERN = /(?:已有|现有|上面|上述|给定|用户提供).{0,16}(?:调研|研究|资料|数据|来源|引用|链接|结果)/i;
const CONTRAST_PATTERN = /(?=但(?:是)?|不过|然而|仍需|还需|同时需要)/g;
const EXPLICIT_RESEARCH_OVERRIDE_PATTERN = /(?:但(?:是)?|不过|然而|仍需|还需|同时需要)(?:(?![。！？!?\n]).){0,40}(?:联网|网上|网络|互联网|全网|外部资料|新闻|官网|官方来源|实时数据|最新|搜索|检索|调研|research)/i;

function researchClauses(value) {
  return String(value || '')
    .replace(CONTRAST_PATTERN, '\n')
    .split(/[，,；;。！？!?\n]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

export function explicitlyForbidsWebResearch(value) {
  const clauses = researchClauses(value);
  const hasDenial = clauses.some((clause) => NEGATED_RESEARCH_PATTERN.test(clause));
  return hasDenial && !EXPLICIT_RESEARCH_OVERRIDE_PATTERN.test(String(value || ''));
}

export function needsWebResearch(value) {
  const clauses = researchClauses(value);

  const hasExplicitOfflineRequirement = clauses.some((clause) => NEGATED_RESEARCH_PATTERN.test(clause));
  if (hasExplicitOfflineRequirement && !EXPLICIT_RESEARCH_OVERRIDE_PATTERN.test(String(value || ''))) return false;

  return clauses.some((clause) => {
    if (NEGATED_RESEARCH_PATTERN.test(clause)) return false;
    if (LOCAL_WORKSPACE_SEARCH_PATTERN.test(clause) && !EXPLICIT_REMOTE_QUALIFIER_PATTERN.test(clause)) return false;
    if (LOCAL_SEARCH_UI_PATTERN.test(clause) && !WEB_SEARCH_QUALIFIER_PATTERN.test(clause)) return false;
    if (hasExplicitOfflineRequirement && EXISTING_RESEARCH_MATERIAL_PATTERN.test(clause)) return false;
    if (EXPLICIT_WEB_RESEARCH_PATTERN.test(clause)) return true;
    return !hasExplicitOfflineRequirement && SOURCED_RESEARCH_PATTERN.test(clause);
  });
}
