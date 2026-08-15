const EXECUTION_MODES = new Set(['advisor', 'executor']);

function text(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function stringList(value, maxItems = 8) {
  return Array.isArray(value)
    ? value.map((item) => text(item, 500)).filter(Boolean).slice(0, maxItems)
    : [];
}

export function defaultModelRequestLimit(tasks) {
  if (tasks.length <= 1) return 8;
  if (tasks.length === 2 && tasks.some((task) => task.mode === 'advisor')) return 12;
  if (tasks.length <= 3) return 16;
  return 24;
}

export function taskModelRequestLimit(mode) {
  return mode === 'advisor' ? 2 : 8;
}

export function normalizeExecutionPlan(proposal, members, fallbackAgentId) {
  if (!Array.isArray(members) || members.length === 0) throw new Error('请先向空间添加至少一个 Agent');
  const memberMap = new Map(members.map((member) => [member.id, member]));
  const hasProductMember = members.some((member) => !member.advisorOnly &&
    /(?:产品|product)/i.test(`${member.id || ''} ${member.name || ''} ${member.category || ''}`));
  const fallback = memberMap.has(fallbackAgentId) ? fallbackAgentId : members[0].id;
  const rawPlan = proposal?.executionPlan;

  if (!Array.isArray(rawPlan) || rawPlan.length === 0) {
    const steps = stringList(proposal?.steps);
    if (steps.length === 0) throw new Error('任务方案缺少可执行步骤');
    return steps.map((instruction, index) => ({
      agentId: fallback,
      agentName: memberMap.get(fallback)?.name || 'Agent',
      mode: 'executor',
      title: text(instruction, 120) || `步骤 ${index + 1}`,
      instruction,
      dependsOn: index === 0 ? [] : [index - 1],
      deliverables: index === steps.length - 1 ? stringList(proposal?.deliverables) : [],
      modelRequestLimit: taskModelRequestLimit('executor'),
    }));
  }

  if (rawPlan.length > 8) throw new Error('执行任务不能超过 8 项');
  const normalized = rawPlan.map((value, index) => {
    if (!value || typeof value !== 'object') throw new Error(`第 ${index + 1} 个执行任务无效`);
    const item = value;
    const agentId = text(item.agentId, 200);
    const mode = text(item.mode, 20);
    const title = text(item.title, 120);
    const instruction = text(item.instruction, 8_000);
    if (!memberMap.has(agentId)) throw new Error(`第 ${index + 1} 个执行任务使用了不在空间中的成员`);
    if (!EXECUTION_MODES.has(mode)) throw new Error(`第 ${index + 1} 个执行任务模式无效`);
    if (memberMap.get(agentId)?.advisorOnly && mode !== 'advisor') {
      throw new Error(`第 ${index + 1} 个执行任务只能将该角色用作顾问`);
    }
    if (memberMap.get(agentId)?.fallbackResearchAdvisor && hasProductMember) {
      throw new Error(`第 ${index + 1} 个调研任务应优先使用空间中的产品成员`);
    }
    if (!title || !instruction) throw new Error(`第 ${index + 1} 个执行任务缺少标题或说明`);
    const dependsOn = Array.isArray(item.dependsOn)
      ? [...new Set(item.dependsOn.filter((dependency) => Number.isInteger(dependency)))]
      : [];
    if (dependsOn.some((dependency) => dependency < 0 || dependency >= index)) {
      throw new Error(`第 ${index + 1} 个执行任务包含无效依赖`);
    }
    return {
      agentId,
      agentName: memberMap.get(agentId)?.name || 'Agent',
      mode,
      title,
      instruction,
      dependsOn,
      deliverables: stringList(item.deliverables),
      modelRequestLimit: taskModelRequestLimit(mode),
    };
  });

  if (proposal?.capabilities?.includes('workspace_write') && !normalized.some((task) => task.mode === 'executor')) {
    throw new Error('需要写入文件的任务方案必须包含至少一个执行角色');
  }
  return normalized;
}
