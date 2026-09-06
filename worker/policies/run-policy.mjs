import { auditGoalCoverage } from '../../lib/agent-runtime-v3-policy.mjs';

function jsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function logicalWorkspacePath(value, workId = null) {
  const normalized = String(value || '').trim().replaceAll('\\', '/').replace(/^\/+/, '');
  const workspacePath = normalized.startsWith('workspace/') ? normalized.slice('workspace/'.length) : normalized;
  const workPrefix = workId ? `works/${workId}/` : '';
  return workPrefix && workspacePath.startsWith(workPrefix)
    ? workspacePath.slice(workPrefix.length)
    : workspacePath;
}

export function matchApprovedWorkspacePaths(touchedPaths, approvedFilePaths, workId = null) {
  const approved = new Set([...approvedFilePaths].map((value) => logicalWorkspacePath(value, workId)).filter(Boolean));
  return [...new Set([...touchedPaths].map((value) => logicalWorkspacePath(value, workId)).filter(Boolean))]
    .filter((relativePath) => approved.has(relativePath));
}

export function evaluateCoordinatorAcceptance({
  goal,
  tasks,
  manifests,
  events,
  expectsWorkspaceWrite = false,
  researchAudit,
  researchResultAudits = [],
  platformIssues = [],
  authorization = null,
  goalCoverage = [],
}) {
  const issues = [...platformIssues];
  const warnings = [];
  const manifestByTaskAttempt = new Map(
    manifests.map((manifest) => [`${manifest.taskId}:${manifest.attempt}`, manifest])
  );
  let workspaceChanges = 0;
  let validatedFiles = 0;
  let commandChecks = 0;
  const goalCoverageAudit = authorization
    ? auditGoalCoverage(authorization, goalCoverage, tasks)
    : null;

  if (goalCoverageAudit?.accepted === false) issues.push(...goalCoverageAudit.issues);
  if (researchAudit?.accepted === false) issues.push(...(researchAudit.issues || ['联网来源验收未通过']));
  for (const audit of researchResultAudits) {
    if (audit?.accepted === false) issues.push(...(audit.issues || ['研究结果引用验收未通过']));
  }
  for (const task of tasks) {
    if (task.status === 'COMPLETED' && !String(task.result || '').trim()) {
      issues.push(`${task.agentName || '成员'}的步骤“${task.title}”没有结果`);
    }
    if (task.status !== 'COMPLETED') continue;
    const manifest = manifestByTaskAttempt.get(`${task.id}:${task.attempt}`);
    if (task.mode === 'advisor' && !manifest) continue;
    if (!manifest) {
      issues.push(`步骤“${task.title}”缺少 ArtifactManifest`);
      continue;
    }
    if (manifest.status !== 'APPLIED') issues.push(`步骤“${task.title}”的工作区变更尚未正式应用`);
    const entries = jsonValue(manifest.entries, []);
    const validation = jsonValue(manifest.validation, {});
    workspaceChanges += Array.isArray(entries) ? entries.length : 0;
    validatedFiles += Array.isArray(validation.files) ? validation.files.length : 0;
    commandChecks += Array.isArray(validation.checks) ? validation.checks.length : 0;
    if (validation.valid === false) {
      issues.push(...(validation.issues?.length ? validation.issues : [`步骤“${task.title}”的产物检查未通过`]));
    }
  }
  if (expectsWorkspaceWrite && workspaceChanges === 0) {
    issues.push(`任务要求修改工作区，但没有检测到净文件变化：${String(goal || '').slice(0, 160)}`);
  }
  for (const event of events) {
    if (['ARTIFACT_MANIFEST_FAILED', 'WORKSPACE_APPLICATION_RECOVERY_FAILED'].includes(event.type)) {
      issues.push(event.message || '工作区审计失败');
    }
  }
  const partial = tasks.some((task) => task.status === 'SKIPPED'
    || (task.status === 'CANCELLED' && Boolean(task.approvedAt || task.startedAt)));
  if (partial) warnings.push('存在已跳过或取消的步骤');
  const uniqueIssues = [...new Set(issues.filter(Boolean))];
  return {
    accepted: uniqueIssues.length === 0,
    status: uniqueIssues.length > 0 ? 'FAILED_VALIDATION' : partial ? 'PARTIAL' : 'COMPLETED',
    issues: uniqueIssues,
    warnings,
    evidence: {
      taskCount: tasks.length,
      completedTaskCount: tasks.filter((task) => task.status === 'COMPLETED').length,
      manifestCount: manifests.length,
      workspaceChanges,
      validatedFiles,
      commandChecks,
      toolEventCount: events.filter((event) => event.type === 'TOOL_COMPLETED').length,
      coveredRequirements: goalCoverageAudit?.coveredCount || 0,
      requirementCount: goalCoverageAudit?.requirementCount || 0,
    },
  };
}

export function completionOutcome(tasks, researchAudit, researchResultAudits, acceptance = null) {
  if (acceptance) {
    const messages = {
      COMPLETED: '任务已完成并通过自动验收',
      PARTIAL: '任务已部分完成并通过现有产物验收',
      FAILED_VALIDATION: '任务自动验收未通过',
    };
    const events = {
      COMPLETED: 'RUN_COMPLETED',
      PARTIAL: 'RUN_PARTIAL',
      FAILED_VALIDATION: 'RUN_VALIDATION_FAILED',
    };
    return { status: acceptance.status, eventType: events[acceptance.status], message: messages[acceptance.status] };
  }
  const validationFailed = researchAudit?.accepted === false
    || researchResultAudits.some((audit) => audit?.accepted === false);
  if (validationFailed) {
    return { status: 'FAILED_VALIDATION', eventType: 'RUN_VALIDATION_FAILED', message: '任务验收未通过' };
  }
  if (tasks.some((task) => ['SKIPPED', 'CANCELLED'].includes(task.status))) {
    return { status: 'PARTIAL', eventType: 'RUN_PARTIAL', message: '任务已部分完成' };
  }
  return { status: 'COMPLETED', eventType: 'RUN_COMPLETED', message: '任务已完成' };
}

export function directRunSummary(tasks, acceptance) {
  const adoptedTasks = tasks.filter((task) => task.status === 'COMPLETED' && String(task.result || '').trim());
  const lastTask = adoptedTasks.at(-1);
  const canUseDirectly = adoptedTasks.length === 1
    || (lastTask?.mode === 'executor' && adoptedTasks.slice(0, -1).every((task) => task.mode === 'advisor'));
  if (!canUseDirectly || !lastTask?.result) return null;
  const acceptanceIssues = acceptance?.accepted === false
    ? `\n\n平台自动验收未通过：${(acceptance.issues || []).join('；') || '产物未满足验收要求'}`
    : '';
  return `${lastTask.result}${acceptanceIssues}`;
}

const BLOCKING_ERROR_MESSAGES = [
  '未配置可用的模型 API Key',
  '空间中没有可执行任务的 Agent',
  '找不到任务成员：',
];

export function executionFailureStatus(error) {
  if (['MODEL_REQUEST_BUDGET', 'MODEL_PROVIDER_TRANSIENT', 'TASK_BLOCKED'].includes(error?.code)) return 'BLOCKED';
  const message = error instanceof Error ? error.message : String(error);
  return BLOCKING_ERROR_MESSAGES.some((candidate) => message.includes(candidate)) ? 'BLOCKED' : 'FAILED';
}

export function leaseCutoffIso(currentTimeMs, leaseTimeoutMs) {
  return new Date(currentTimeMs - leaseTimeoutMs).toISOString();
}

const PAUSED_RUN_STATUSES = new Set([
  'QUEUED',
  'WAITING',
  'WAITING_APPROVAL',
  'BLOCKED',
  'CANCEL_REQUESTED',
  'CANCELLED',
]);

export function shouldPauseRunProcessing(status) {
  return PAUSED_RUN_STATUSES.has(status);
}
