import { needsWebResearch } from './web-research-intent.mjs';

const USER_CLARIFICATION_STEP_PATTERN = /(?:向?用户(?:询问|确认)|确认用户|询问用户|等待用户|让用户|请用户|用户(?:补充|提供|确认|回答|回复)|需要用户(?:补充|提供|确认|回答|回复))/i;
const USER_CLARIFICATION_GOAL_PATTERN = /(?:等待|需要|请)用户(?:补充|提供|确认|回答|回复)/i;

export function taskProposalNeedsClarification(goal, steps = []) {
  return steps.some((step) => USER_CLARIFICATION_STEP_PATTERN.test(String(step || '')))
    || USER_CLARIFICATION_GOAL_PATTERN.test(String(goal || ''));
}

export function taskProposalNeedsWebResearch(goal, steps = [], deliverables = []) {
  const text = `${goal}\n${steps.join('\n')}\n${deliverables.join('\n')}`;
  return needsWebResearch(text);
}

export function normalizeTaskProposalSteps(steps = [], artifacts = []) {
  const normalizedSteps = steps.map((step) => String(step || '').trim()).filter(Boolean);
  const normalizedArtifacts = artifacts.map((artifact) => String(artifact || '').trim()).filter(Boolean);
  if (normalizedArtifacts.length !== 1 || normalizedSteps.length <= 1) return normalizedSteps;
  return [`完成并验收${normalizedArtifacts[0]}：${normalizedSteps.join('；')}`];
}
