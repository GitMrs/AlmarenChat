import { needsWebResearch } from './web-research-intent.mjs';
import { needsWorkspaceWrite } from './workspace-write-intent.mjs';

const USER_CLARIFICATION_STEP_PATTERN = /(?:向?用户(?:询问|确认)|确认用户|询问用户|等待用户|让用户|请用户|用户(?:补充|提供|确认|回答|回复)|需要用户(?:补充|提供|确认|回答|回复))/i;
const USER_CLARIFICATION_GOAL_PATTERN = /(?:等待|需要|请)用户(?:补充|提供|确认|回答|回复)/i;
const PROFESSIONAL_ACTION_PATTERN = /(?:分析|评估|审查|诊断|调研|研究|对比|规划|设计|制定|梳理|优化|复盘|核查|review|analy[sz]e|assess|audit|research|design|plan)/i;
const BOUNDED_OUTPUT_PATTERN = /(?:给出|提供|输出|形成|整理|提交|交付|产出).{0,24}(?:建议|方案|结论|清单|报告|策略|计划|结果)|(?:正好|至少|至多|不超过|不少于|必须|要求).{0,12}(?:\d+|[一二三四五六七八九十]+)\s*(?:条|项|个|点)|(?:改进建议|实施建议|行动建议|验收标准|输出要求|deliverable|recommendation|report|checklist)/i;
const DIRECT_RESPONSE_OVERRIDE_PATTERN = /(?:直接回答|简单回答|无需创建任务|不用创建任务|不要创建任务|无需派发|不用派发|不要派发|do not create (?:a )?task|no task)/i;

export function professionalDeliverableNeedsTask(input) {
  const text = String(input || '').trim();
  if (!text || DIRECT_RESPONSE_OVERRIDE_PATTERN.test(text)) return false;
  return PROFESSIONAL_ACTION_PATTERN.test(text) && BOUNDED_OUTPUT_PATTERN.test(text);
}

export function taskProposalNeedsClarification(goal, steps = []) {
  return steps.some((step) => USER_CLARIFICATION_STEP_PATTERN.test(String(step || '')))
    || USER_CLARIFICATION_GOAL_PATTERN.test(String(goal || ''));
}

export function taskProposalNeedsWebResearch(goal, steps = [], deliverables = []) {
  const text = `${goal}\n${steps.join('\n')}\n${deliverables.join('\n')}`;
  return needsWebResearch(text);
}

export function taskProposalWithServerCapabilities(proposal = {}) {
  const goal = typeof proposal.goal === 'string' ? proposal.goal.trim() : '';
  const list = (value) => Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const steps = list(proposal.steps);
  const deliverables = list(proposal.deliverables);
  const text = `${goal}\n${steps.join('\n')}\n${deliverables.join('\n')}`;
  return {
    ...proposal,
    goal,
    steps,
    deliverables,
    capabilities: [
      'workspace_read',
      ...(needsWorkspaceWrite(text) ? ['workspace_write'] : []),
      ...(taskProposalNeedsWebResearch(goal, steps, deliverables) ? ['web_research'] : []),
    ],
  };
}

export function normalizeTaskProposalSteps(steps = [], artifacts = []) {
  const normalizedSteps = steps.map((step) => String(step || '').trim()).filter(Boolean);
  const normalizedArtifacts = artifacts.map((artifact) => String(artifact || '').trim()).filter(Boolean);
  if (normalizedArtifacts.length !== 1 || normalizedSteps.length <= 1) return normalizedSteps;
  return [`完成并验收${normalizedArtifacts[0]}：${normalizedSteps.join('；')}`];
}
