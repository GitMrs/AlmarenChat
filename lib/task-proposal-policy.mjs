const USER_CLARIFICATION_STEP_PATTERN = /(?:向?用户(?:询问|确认)|确认用户|询问用户|等待用户|让用户|请用户|用户(?:补充|提供|确认|回答|回复)|需要用户(?:补充|提供|确认|回答|回复))/i;
const USER_CLARIFICATION_GOAL_PATTERN = /(?:等待|需要|请)用户(?:补充|提供|确认|回答|回复)/i;
const EXPLICIT_WEB_RESEARCH_PATTERN = /(?:联网|搜索|检索|调研|收集资料|查找资料|最新|市场调研|竞品|research)/i;
const SOURCED_RESEARCH_PATTERN = /(?:资料|数据|事实|结论|信息).{0,12}(?:来源|引用)|(?:标注|提供|附上|列出|补充).{0,12}(?:来源|引用|链接|网址)|(?:来源|引用).{0,12}(?:链接|网址|url|资料|数据|文献|论文|官网|官方)/i;

export function taskProposalNeedsClarification(goal, steps = []) {
  return steps.some((step) => USER_CLARIFICATION_STEP_PATTERN.test(String(step || '')))
    || USER_CLARIFICATION_GOAL_PATTERN.test(String(goal || ''));
}

export function taskProposalNeedsWebResearch(goal, steps = [], deliverables = []) {
  const text = `${goal}\n${steps.join('\n')}\n${deliverables.join('\n')}`;
  return EXPLICIT_WEB_RESEARCH_PATTERN.test(text) || SOURCED_RESEARCH_PATTERN.test(text);
}

export function normalizeTaskProposalSteps(steps = [], artifacts = []) {
  const normalizedSteps = steps.map((step) => String(step || '').trim()).filter(Boolean);
  const normalizedArtifacts = artifacts.map((artifact) => String(artifact || '').trim()).filter(Boolean);
  if (normalizedArtifacts.length !== 1 || normalizedSteps.length <= 1) return normalizedSteps;
  return [`完成并验收${normalizedArtifacts[0]}：${normalizedSteps.join('；')}`];
}
