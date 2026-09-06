import { explicitlyForbidsWebResearch, needsWebResearch } from './web-research-intent.mjs';
import { needsWorkspaceWrite } from './workspace-write-intent.mjs';

const USER_CLARIFICATION_PATTERN = /(?:向?用户(?:询问|确认)|确认用户|询问用户|等待用户|让用户|请用户|(?:等待|需要|请)用户(?:补充|提供|确认|回答|回复)|用户(?:补充|提供|回答|回复).{0,16}后)/i;
const NEGATED_USER_CLARIFICATION_PATTERN = /(?:无需|不需要|不用|不要|不必|不再)(?:(?!但|但是|不过|然而|仍需|还需).){0,16}(?:用户|询问|确认|等待|补充|提供|回答|回复)/i;
const PROFESSIONAL_ACTION_PATTERN = /(?:分析|评估|审查|诊断|调研|研究|对比|规划|设计|制定|梳理|优化|复盘|核查|review|analy[sz]e|assess|audit|research|design|plan)/i;
const BOUNDED_OUTPUT_PATTERN = /(?:给出|提供|输出|形成|整理|生成|创建|制作|提交|交付|产出).{0,24}(?:建议|方案|结论|清单|报告|文档|文件|页面|策略|计划|结果)|(?:正好|至少|至多|不超过|不少于|必须|要求).{0,12}(?:\d+|[一二三四五六七八九十]+)\s*(?:条|项|个|点)|(?:改进建议|实施建议|行动建议|验收标准|输出要求|deliverable|recommendation|report|checklist)/i;
const DIRECT_RESPONSE_OVERRIDE_PATTERN = /(?:直接回答|简单回答|无需创建任务|不用创建任务|不要创建任务|无需派发|不用派发|不要派发|do not create (?:a )?task|no task)/i;
const CODE_EXECUTION_PATTERN = /(?:运行|执行|调用).{0,16}(?:python|node|脚本|命令|测试|构建|编译)|(?:python|node|shell|bash|脚本|命令|测试|构建|编译)|(?:csv|逗号分隔).{0,40}(?:分析|统计|汇总|报告)|(?:分析|统计|汇总).{0,40}(?:csv|逗号分隔)/i;
const REMOTE_ASSET_REQUEST_PATTERN = /(?:找|寻找|查找|搜索|获取).{0,30}(?:真实|官方|原版|角色)?(?:照片|图片|头像|素材)|(?:真实|官方|原版)(?:照片|图片|头像|素材).{0,20}(?:替换|使用|找|寻找|搜索|查找|获取)|(?:先|帮我)?查(?:一下|一个)?.{0,30}(?:资料|信息|来源)/i;

export function professionalDeliverableNeedsTask(input) {
  const text = String(input || '').trim();
  if (!text || DIRECT_RESPONSE_OVERRIDE_PATTERN.test(text)) return false;
  return PROFESSIONAL_ACTION_PATTERN.test(text) && BOUNDED_OUTPUT_PATTERN.test(text);
}

export function taskProposalNeedsClarification(goal, steps = []) {
  return [goal, ...steps].some((value) => String(value || '')
    .split(/[，,；;。！？!?\n]+/)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .some((clause) => !NEGATED_USER_CLARIFICATION_PATTERN.test(clause) && USER_CLARIFICATION_PATTERN.test(clause)));
}

export function taskProposalNeedsWebResearch(goal, steps = [], deliverables = []) {
  const text = `${goal}\n${steps.join('\n')}\n${deliverables.join('\n')}`;
  return needsWebResearch(text);
}

export function taskProposalNeedsCodeExecution(goal, steps = [], deliverables = []) {
  return CODE_EXECUTION_PATTERN.test(`${goal}\n${steps.join('\n')}\n${deliverables.join('\n')}`);
}

export function taskProposalWithServerCapabilities(proposal = {}, options = {}) {
  const goal = typeof proposal.goal === 'string' ? proposal.goal.trim() : '';
  const list = (value) => Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const steps = list(proposal.steps);
  const deliverables = list(proposal.deliverables);
  const declaredCapabilities = Array.isArray(proposal.capabilities)
    ? [...new Set(proposal.capabilities.filter((capability) =>
        capability === 'workspace_read' || capability === 'workspace_write' || capability === 'web_research' || capability === 'code_execute' || capability === 'image_generate'
      ))]
    : null;
  const text = `${goal}\n${steps.join('\n')}\n${deliverables.join('\n')}`;
  const declaredNetworkPolicy = ['forbidden', 'allowed', 'required'].includes(proposal.networkPolicy)
    ? proposal.networkPolicy
    : null;
  const inferredResearchRequired = taskProposalNeedsWebResearch(goal, steps, deliverables);
  const networkPolicy = options.networkPolicyAuthoritative && declaredNetworkPolicy
    ? declaredNetworkPolicy
    : explicitlyForbidsWebResearch(text)
      ? 'forbidden'
      : inferredResearchRequired
        ? 'required'
        : declaredNetworkPolicy
          || (declaredCapabilities?.includes('web_research') ? 'required' : 'forbidden');
  const inferredCapabilities = [
    'workspace_read',
    ...(needsWorkspaceWrite(text) ? ['workspace_write'] : []),
    ...(taskProposalNeedsCodeExecution(goal, steps, deliverables) ? ['code_execute'] : []),
  ];
  const capabilities = [...new Set([...(declaredCapabilities || []), ...inferredCapabilities])]
    .filter((capability) => capability !== 'web_research');
  if (networkPolicy !== 'forbidden') capabilities.push('web_research');
  return {
    ...proposal,
    goal,
    steps,
    deliverables,
    // Model declarations preserve semantic intent, while server inference
    // guarantees that explicit file and research requirements cannot be omitted.
    networkPolicy,
    capabilities,
  };
}

export function taskProposalWithTurnNetworkAuthorization(proposal = {}, allowWebSearch = false, userRequest = '') {
  const requestText = String(userRequest || '');
  const requestRequiresResearch = allowWebSearch
    && !explicitlyForbidsWebResearch(requestText)
    && (needsWebResearch(requestText) || REMOTE_ASSET_REQUEST_PATTERN.test(requestText));
  const declaredNetworkPolicy = ['forbidden', 'allowed', 'required'].includes(proposal.networkPolicy)
    ? proposal.networkPolicy
    : Array.isArray(proposal.capabilities) && proposal.capabilities.includes('web_research')
      ? 'required'
      : 'forbidden';
  return taskProposalWithServerCapabilities({
    ...proposal,
    networkPolicy: allowWebSearch
      ? (requestRequiresResearch ? 'required' : declaredNetworkPolicy)
      : 'forbidden',
    capabilities: requestRequiresResearch
      ? [...new Set([...(Array.isArray(proposal.capabilities) ? proposal.capabilities : []), 'web_research'])]
      : proposal.capabilities,
  }, { networkPolicyAuthoritative: true });
}

export function normalizeTaskProposalSteps(steps = [], artifacts = []) {
  const normalizedSteps = steps.map((step) => String(step || '').trim()).filter(Boolean);
  const normalizedArtifacts = artifacts.map((artifact) => String(artifact || '').trim()).filter(Boolean);
  if (normalizedArtifacts.length !== 1 || normalizedSteps.length <= 1) return normalizedSteps;
  return [`完成并验收${normalizedArtifacts[0]}：${normalizedSteps.join('；')}`];
}
