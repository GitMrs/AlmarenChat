import { taskRequiresWorkspaceWrite } from './workspace-write-intent.mjs';
import { resolveTaskSkill } from './agent-runtime/skill-registry.mjs';
import { explicitlyForbidsWebResearch } from './web-research-intent.mjs';

const ACTIONS = new Set(['dispatch', 'finish', 'block']);
const MODES = new Set(['advisor', 'executor']);
const ACTIVE_TASK_STATUSES = new Set(['PROPOSED', 'PENDING', 'RUNNING', 'WAITING', 'WAITING_USER', 'SUBMITTED', 'REVIEWING']);

export const COORDINATOR_ACTION_TOOL_NAME = 'submit_coordinator_action';
export const COORDINATOR_REVIEW_TOOL_NAME = 'submit_coordinator_review';

export const COORDINATOR_ACTION_TOOL = {
  type: 'function',
  function: {
    name: COORDINATOR_ACTION_TOOL_NAME,
    description: '提交 Coordinator 当前唯一的结构化动作：派发下一项工作、完成目标或报告阻塞。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'summary'],
      properties: {
        type: { type: 'string', enum: ['dispatch', 'finish', 'block'] },
        summary: { type: 'string' },
        reason: { type: 'string' },
        tasks: {
          type: 'array',
          maxItems: 2,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['agentId', 'skillId', 'mode', 'title', 'instruction', 'acceptanceCriteria', 'reason', 'webResearchRequired'],
            properties: {
              agentId: { type: 'string' },
              skillId: { type: 'string', description: '必须来自当前成员 availableSkills 中的 Skill ID。' },
              mode: { type: 'string', enum: ['advisor', 'executor'] },
              title: { type: 'string' },
              instruction: { type: 'string' },
              acceptanceCriteria: { type: 'string' },
              reason: { type: 'string' },
              webResearchRequired: { type: 'boolean', description: '当前子任务是否确实需要联网资料。' },
              expectedArtifacts: { type: 'array', maxItems: 8, items: { type: 'string' } },
            },
          },
        },
        coverage: {
          type: 'array',
          maxItems: 16,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['requirement', 'taskIds', 'evidence'],
            properties: {
              requirement: { type: 'string' },
              taskIds: { type: 'array', items: { type: 'string' } },
              evidence: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

export const COORDINATOR_REVIEW_TOOL = {
  type: 'function',
  function: {
    name: COORDINATOR_REVIEW_TOOL_NAME,
    description: '提交 Coordinator 对成员任务的结构化验收决定。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['decision', 'summary', 'feedback', 'publicNote'],
      properties: {
        decision: { type: 'string', enum: ['accept', 'revise', 'block'] },
        summary: { type: 'string' },
        feedback: { type: 'string' },
        publicNote: { type: 'string' },
      },
    },
  },
};

export function structuredToolOutput(message, toolName) {
  const call = Array.isArray(message?.tool_calls)
    ? message.tool_calls.find((item) => item?.function?.name === toolName)
    : null;
  return call?.function?.arguments || message?.content || '';
}

export function dispatchRequiresApproval(executionMode) {
  return executionMode !== 'AUTO';
}

export function authorizationAllowsCapability(authorization, capability) {
  if (capability === 'web_research' && authorization?.networkPolicy === 'forbidden') return false;
  return Array.isArray(authorization?.capabilities) && authorization.capabilities.includes(capability);
}

export function coordinatorDecisionTrigger(runId, tasks = [], state = {}) {
  if (state?.phase !== 'coordinating') return null;
  if (tasks.some((task) => ACTIVE_TASK_STATUSES.has(task?.status))) return null;
  const feedback = state?.lastDispatchFeedback;
  if (feedback?.taskId && feedback?.at) {
    return `dispatch-rejected:${feedback.taskId}:${feedback.at}`;
  }
  if (tasks.length === 0) return `run-authorized:${runId}`;
  return `coordinator-resume:${runId}:${Math.max(0, Number(state?.iteration || 0))}`;
}

export function dispatchConstraintFromFeedback(feedback, members = []) {
  const source = text(feedback, 2_000);
  if (!source) return null;
  const candidates = [];
  for (const member of members) {
    const name = text(member?.name, 200);
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?:交给|派给|安排给|让|由)\\s*${escaped}`, 'g');
    for (const match of source.matchAll(pattern)) {
      const index = match.index || 0;
      const prefix = source.slice(Math.max(0, index - 8), index);
      if (/(?:不要|不用|无需|不需要|别|避免).{0,4}$/.test(prefix)) continue;
      candidates.push({
        agentId: member.id,
        agentName: name,
        index,
        priority: /先.{0,4}$/.test(prefix) ? 0 : 1,
      });
    }
  }
  candidates.sort((left, right) => left.priority - right.priority || left.index - right.index);
  if (candidates.length === 0) return null;
  const { agentId, agentName } = candidates[0];
  return { agentId, agentName };
}

export function coordinatorStateAfterDispatchRejection(state, { feedback, task, timestamp }) {
  const reason = text(feedback, 2_000);
  if (!reason) throw new Error('请说明拒绝这次派发的原因');
  return {
    ...(state && typeof state === 'object' ? state : {}),
    phase: 'coordinating',
    currentTaskIds: [],
    lastDecision: `用户退回了“${text(task?.title, 160) || '当前任务'}”的派发提案。`,
    lastDispatchFeedback: {
      feedback: reason,
      taskId: text(task?.id, 200),
      agentId: text(task?.agentId, 200),
      agentName: text(task?.agentName, 200),
      title: text(task?.title, 160),
      at: timestamp,
    },
  };
}

function text(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function jsonObject(content) {
  if (content && typeof content === 'object' && !Array.isArray(content)) return content;
  const source = String(content || '');
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('协调者没有返回有效动作');
  return JSON.parse(source.slice(start, end + 1));
}

function normalizedRequirement(value) {
  return text(value, 1_000).toLocaleLowerCase().replace(/\s+/g, ' ');
}

export function coordinatorTaskReviewInstructions(mode) {
  const format = `必须调用 ${COORDINATOR_REVIEW_TOOL_NAME} 提交：{"decision":"accept|revise|block","summary":"验收结论","feedback":"返工要求","publicNote":"给用户看的简短进度"}。`;
  if (mode === 'advisor') {
    return '你是 AI 团队的 Coordinator，正在验收 advisor 顾问任务。advisor 可以读取工作区；任务明确要求文件且获得写入授权时，也可以提交经过校验的工作区文件。' +
      '任务未要求文件时，manifest 为 null、没有工作区变更是正常状态，只依据报告正文做语义验收；任务明确要求文件时，则必须结合 manifest、文件差异和校验结果验收。' +
      format +
      '报告正文覆盖任务要求且可供后续成员直接使用时 accept；内容有可修复缺口时 revise；缺少必要条件或多次返工无效时 block。不要要求无关润色。';
  }
  return '你是 AI 团队的 Coordinator。依据真实提交报告、文件差异和校验结果做 executor 执行任务的语义验收。' +
    format +
    '符合目标且证据充分时 accept；有可修复缺口时 revise；缺少必要条件或多次返工无效时 block。不要要求无关润色。';
}

export function coordinatorTaskReviewRequest(goal, task, material) {
  const acceptanceCriteria = text(task?.acceptanceCriteria, 4_000);
  const acceptance = acceptanceCriteria
    ? `\n\n本步骤验收标准（必须逐条核对）：\n${acceptanceCriteria}`
    : '';
  return `总目标：${goal}\n\n任务模式：${task?.mode || ''}\n任务：${task?.title || ''}\n${task?.instruction || ''}${acceptance}\n\n提交材料：${JSON.stringify(material)}`;
}

export function normalizeCoordinatorReviewAction(content) {
  const value = jsonObject(content);
  const decision = text(value.decision, 40);
  if (!['accept', 'revise', 'block'].includes(decision)) {
    throw new Error('协调者没有返回有效的验收决定');
  }
  return {
    decision,
    summary: text(value.summary, 2_000) || '协调者已完成验收',
    feedback: text(value.feedback, 4_000),
    publicNote: text(value.publicNote || value.summary, 1_000),
  };
}

export async function requestCoordinatorReviewAction(requestReview, hooks = {}) {
  const maxAttempts = Math.min(3, Math.max(1, Number(hooks.maxAttempts || 3)));
  let previousError = null;
  let previousDiagnostics = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await requestReview({ attempt, previousError, previousDiagnostics });
    const wrapped = response?.coordinatorReviewResponse === true;
    const content = wrapped ? response.output : response;
    const diagnostics = wrapped ? response.diagnostics || null : null;
    try {
      return normalizeCoordinatorReviewAction(content);
    } catch (error) {
      previousError = error instanceof Error ? error : new Error(String(error));
      previousDiagnostics = diagnostics;
      if (attempt >= maxAttempts) {
        previousError.code = 'COORDINATOR_REVIEW_INVALID';
        previousError.diagnostics = previousDiagnostics;
        throw previousError;
      }
      await hooks.onInvalid?.({ attempt, error: previousError, diagnostics });
    }
  }
  throw previousError || new Error('协调者没有返回有效的验收决定');
}

export function authorizationRequirements(authorization = {}) {
  const values = [
    ...(Array.isArray(authorization.steps) ? authorization.steps : []),
    ...(Array.isArray(authorization.deliverables) ? authorization.deliverables : []),
  ];
  if (values.length === 0 && authorization.objective) values.push(authorization.objective);
  const seen = new Set();
  return values.map((value) => text(value, 1_000)).filter((value) => {
    const normalized = normalizedRequirement(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function auditGoalCoverage(authorization, coverage, completedTasks = []) {
  const requirements = authorizationRequirements(authorization);
  const completedTaskIds = new Set(
    completedTasks.filter((task) => task?.status === 'COMPLETED').map((task) => task.id)
  );
  const coverageByRequirement = new Map();
  for (const item of Array.isArray(coverage) ? coverage : []) {
    const requirement = text(item?.requirement, 1_000);
    const normalized = normalizedRequirement(requirement);
    if (!normalized || coverageByRequirement.has(normalized)) continue;
    coverageByRequirement.set(normalized, {
      requirement,
      taskIds: Array.isArray(item?.taskIds)
        ? [...new Set(item.taskIds.map((id) => text(id, 200)).filter((id) => completedTaskIds.has(id)))]
        : [],
      evidence: text(item?.evidence, 2_000),
    });
  }
  const issues = [];
  const acceptedCoverage = [];
  let coveredCount = 0;
  for (const requirement of requirements) {
    const item = coverageByRequirement.get(normalizedRequirement(requirement));
    if (!item) {
      issues.push(`授权要求尚未覆盖：${requirement}`);
      continue;
    }
    if (item.taskIds.length === 0) issues.push(`授权要求缺少已验收任务依据：${requirement}`);
    if (!item.evidence) issues.push(`授权要求缺少完成证据：${requirement}`);
    if (item.taskIds.length > 0 && item.evidence) coveredCount += 1;
    acceptedCoverage.push({ ...item, requirement });
  }
  return {
    accepted: issues.length === 0,
    requirements,
    coverage: acceptedCoverage,
    issues,
    coveredCount,
    requirementCount: requirements.length,
  };
}

export function normalizeCoordinatorAction(content, options = {}) {
  const value = jsonObject(content);
  const type = text(value.type, 40);
  if (!ACTIONS.has(type)) throw new Error(`协调者动作无效：${type || 'EMPTY'}`);

  const summary = text(value.summary, 2_000);
  if (type === 'finish') {
    if (!options.allowFinish) throw new Error('尚无已验收成果，协调者不能结束任务');
    const requirements = Array.isArray(options.requirements) ? options.requirements : [];
    const completedTaskIds = new Set(options.completedTaskIds || []);
    const coverage = Array.isArray(value.coverage) ? value.coverage : [];
    if (requirements.length > 0) {
      const audit = auditGoalCoverage(
        { steps: requirements },
        coverage,
        [...completedTaskIds].map((id) => ({ id, status: 'COMPLETED' }))
      );
      if (!audit.accepted) throw new Error(`协调者不能结束任务：${audit.issues.join('；')}`);
      return { type, summary: summary || '任务目标已经满足，可以交付。', coverage: audit.coverage };
    }
    return { type, summary: summary || '任务目标已经满足，可以交付。', coverage: [] };
  }
  if (type === 'block') {
    const reason = text(value.reason || value.summary, 4_000);
    if (!reason) throw new Error('协调者阻塞动作缺少原因');
    return { type, reason, summary: summary || reason };
  }

  const members = new Map((options.members || []).map((member) => [member.id, member]));
  const remaining = Math.max(0, Number(options.remainingTasks || 0));
  const rawTasks = Array.isArray(value.tasks) ? value.tasks : [];
  if (rawTasks.length === 0) throw new Error('协调者派发动作缺少任务');
  if (rawTasks.length > Math.min(2, remaining)) throw new Error('协调者本轮派发任务超过剩余上限');
  if (options.requiredAgentId && text(rawTasks[0]?.agentId, 200) !== options.requiredAgentId) {
    throw new Error(`用户要求下一步先交给${text(options.requiredAgentName, 200) || options.requiredAgentId}`);
  }

  const existingSignatures = new Set((options.existingTasks || []).map((task) =>
    `${task.agentId}\n${String(task.title || '').trim().toLowerCase()}\n${String(task.instruction || '').trim().toLowerCase()}`
  ));
  const selectedAgents = new Set();
  const tasks = rawTasks.map((raw, index) => {
    const item = raw && typeof raw === 'object' ? raw : {};
    const agentId = text(item.agentId, 200);
    const member = members.get(agentId);
    if (!member) throw new Error(`第 ${index + 1} 个任务使用了不在空间中的成员`);
    if (selectedAgents.has(agentId)) throw new Error(`同一轮不能给 ${member.name || agentId} 派发两项任务`);
    if (index === 0 && options.requiredSkillId && text(item.skillId, 200) !== options.requiredSkillId) {
      throw new Error(`用户明确指定了 Skill：${options.requiredSkillId}`);
    }
    selectedAgents.add(agentId);
    const mode = text(item.mode, 20) || 'executor';
    if (!MODES.has(mode)) throw new Error(`第 ${index + 1} 个任务模式无效`);
    const title = text(item.title, 160);
    const instruction = text(item.instruction, 8_000);
    const acceptanceCriteria = text(item.acceptanceCriteria, 4_000);
    const reason = text(item.reason, 1_000);
    const expectedArtifacts = Array.isArray(item.expectedArtifacts)
      ? item.expectedArtifacts.map((entry) => text(entry, 500)).filter(Boolean).slice(0, 8)
      : [];
    const webResearchRequired = item.webResearchRequired === true;
    if (!title || !instruction || !acceptanceCriteria || !reason) {
      throw new Error(`第 ${index + 1} 个任务缺少标题、指令、验收标准或选人理由`);
    }
    const workspaceWriteRequired = taskRequiresWorkspaceWrite(
      `${instruction}\n${acceptanceCriteria}\n预期可验收产物：${expectedArtifacts.join('、')}`
    );
    if (workspaceWriteRequired && options.workspaceWriteAllowed === false) {
      throw new Error(`第 ${index + 1} 个任务要求创建或修改工作区文件，但目标未授权 workspace_write`);
    }
    const taskText = `${title}\n${instruction}\n${acceptanceCriteria}\n${expectedArtifacts.join('\n')}`;
    if (webResearchRequired && !authorizationAllowsCapability(options.authorization, 'web_research')) {
      throw new Error(`第 ${index + 1} 个任务要求联网，但目标未授权 web_research`);
    }
    if (webResearchRequired && explicitlyForbidsWebResearch(taskText)) {
      throw new Error(`第 ${index + 1} 个任务的指令明确禁止联网`);
    }
    const skill = resolveTaskSkill({
      requestedSkillId: item.skillId,
      agent: member,
      text: `${title}\n${instruction}\n${acceptanceCriteria}\n${expectedArtifacts.join('\n')}`,
      authorization: options.authorization,
      additionalSkills: options.additionalSkills,
    });
    if (skill.execution && mode !== 'executor') {
      throw new Error(`第 ${index + 1} 个任务使用可执行 Skill，必须派发为 executor 模式`);
    }
    const signature = `${agentId}\n${title.toLowerCase()}\n${instruction.toLowerCase()}`;
    if (existingSignatures.has(signature)) throw new Error(`第 ${index + 1} 个任务与已有任务重复`);
    existingSignatures.add(signature);
    return {
      agentId,
      agentName: member.name || 'Agent',
      mode,
      title,
      instruction,
      acceptanceCriteria,
      reason,
      expectedArtifacts,
      workspaceWriteRequired,
      webResearchRequired,
      skillId: skill.id,
      skillVersion: skill.version,
      skillSnapshot: skill,
    };
  });
  return { type, summary: summary || '协调者已安排下一项工作。', tasks };
}

export async function requestCoordinatorAction(requestAction, options = {}, hooks = {}) {
  const maxAttempts = Math.min(3, Math.max(1, Number(hooks.maxAttempts || 3)));
  let previousError = null;
  let previousDiagnostics = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await requestAction({ attempt, previousError, previousDiagnostics });
    const wrapped = response?.coordinatorResponse === true;
    const content = wrapped ? response.output : response;
    const diagnostics = wrapped ? response.diagnostics || null : null;
    try {
      return normalizeCoordinatorAction(content, options);
    } catch (error) {
      previousError = error instanceof Error ? error : new Error(String(error));
      previousDiagnostics = diagnostics;
      if (attempt >= maxAttempts) {
        previousError.code = 'COORDINATOR_ACTION_INVALID';
        previousError.diagnostics = diagnostics;
        throw previousError;
      }
      await hooks.onInvalid?.({ attempt, error: previousError, diagnostics });
    }
  }
  throw previousError || new Error('协调者没有返回有效动作');
}

export function coordinatorAuthorization(proposal = {}) {
  const list = (value) => Array.isArray(value)
    ? value.map((item) => text(item, 1_000)).filter(Boolean).slice(0, 8)
    : [];
  const selectedSkill = proposal.skillSnapshot && typeof proposal.skillSnapshot === 'object'
    ? JSON.parse(JSON.stringify(proposal.skillSnapshot))
    : null;
  return {
    objective: text(proposal.goal, 12_000),
    steps: list(proposal.steps),
    deliverables: list(proposal.deliverables),
    artifacts: list(proposal.artifacts),
    capabilities: list(proposal.capabilities),
    networkPolicy: ['forbidden', 'allowed', 'required'].includes(proposal.networkPolicy)
      ? proposal.networkPolicy
      : (list(proposal.capabilities).includes('web_research') ? 'required' : 'forbidden'),
    maxTasks: 8,
    ...(selectedSkill ? {
      selectedSkill,
      selectedSkillAgentId: text(proposal.skillAgentId, 200) || null,
    } : {}),
  };
}
