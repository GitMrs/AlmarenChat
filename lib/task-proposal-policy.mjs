const USER_CLARIFICATION_STEP_PATTERN = /(?:向?用户(?:询问|确认)|确认用户|询问用户|等待用户|让用户|请用户|用户(?:补充|提供|确认|回答|回复)|需要用户(?:补充|提供|确认|回答|回复))/i;
const USER_CLARIFICATION_GOAL_PATTERN = /(?:等待|需要|请)用户(?:补充|提供|确认|回答|回复)/i;

export function taskProposalNeedsClarification(goal, steps = []) {
  return steps.some((step) => USER_CLARIFICATION_STEP_PATTERN.test(String(step || '')))
    || USER_CLARIFICATION_GOAL_PATTERN.test(String(goal || ''));
}
