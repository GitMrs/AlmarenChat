const ACTIONS = new Set(['dispatch', 'finish', 'block']);
const MODES = new Set(['advisor', 'executor']);

export function dispatchRequiresApproval(executionMode) {
  return executionMode !== 'AUTO';
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

export function normalizeCoordinatorAction(content, options = {}) {
  const value = jsonObject(content);
  const type = text(value.type, 40);
  if (!ACTIONS.has(type)) throw new Error(`协调者动作无效：${type || 'EMPTY'}`);

  const summary = text(value.summary, 2_000);
  if (type === 'finish') {
    if (!options.allowFinish) throw new Error('尚无已验收成果，协调者不能结束任务');
    return { type, summary: summary || '任务目标已经满足，可以交付。' };
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
    if (!title || !instruction || !acceptanceCriteria || !reason) {
      throw new Error(`第 ${index + 1} 个任务缺少标题、指令、验收标准或选人理由`);
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
    };
  });
  return { type, summary: summary || '协调者已安排下一项工作。', tasks };
}

export function coordinatorAuthorization(proposal = {}) {
  const list = (value) => Array.isArray(value)
    ? value.map((item) => text(item, 1_000)).filter(Boolean).slice(0, 8)
    : [];
  return {
    objective: text(proposal.goal, 12_000),
    steps: list(proposal.steps),
    deliverables: list(proposal.deliverables),
    artifacts: list(proposal.artifacts),
    capabilities: list(proposal.capabilities),
    maxTasks: 8,
  };
}
