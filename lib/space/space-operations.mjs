const FAILED_RUN_STATUSES = new Set(['PARTIAL', 'FAILED_VALIDATION', 'FAILED', 'BLOCKED', 'CANCELLED']);

function percentage(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : null;
}

export function summarizeSpaceOperations({ works = [], runs = [], automationExecutions = [], actions = [] }, periodDays = 30) {
  const completedRuns = runs.filter((run) => run.status === 'COMPLETED').length;
  const failedRuns = runs.filter((run) => FAILED_RUN_STATUSES.has(run.status)).length;
  const completedAutomations = automationExecutions.filter((execution) => execution.status === 'COMPLETED').length;
  const failedAutomations = automationExecutions.filter((execution) => FAILED_RUN_STATUSES.has(execution.status)).length;
  const completedDrafts = actions.filter((action) => action.kind === 'WECHAT_CREATE_DRAFT' && action.status === 'COMPLETED').length;
  const completedPublications = actions.filter((action) => action.kind === 'WECHAT_PUBLISH' && action.status === 'COMPLETED').length;
  const failedExternalActions = actions.filter((action) => ['WECHAT_CREATE_DRAFT', 'WECHAT_PUBLISH'].includes(action.kind) && action.status === 'FAILED').length;
  return {
    periodDays,
    works: {
      total: works.length,
      active: works.filter((work) => work.status === 'ACTIVE').length,
      ready: works.filter((work) => work.status === 'COMPLETED').length,
      awaitingFinalization: works.filter((work) => work.status === 'ACTIVE' && work.stage === 'review').length,
    },
    runs: {
      total: runs.length,
      completed: completedRuns,
      failed: failedRuns,
      successRate: percentage(completedRuns, completedRuns + failedRuns),
    },
    automation: {
      total: automationExecutions.length,
      completed: completedAutomations,
      failed: failedAutomations,
      successRate: percentage(completedAutomations, completedAutomations + failedAutomations),
    },
    publishing: {
      draftsCreated: completedDrafts,
      publicationsCompleted: completedPublications,
      failed: failedExternalActions,
      pendingApprovals: actions.filter((action) => ['WECHAT_CREATE_DRAFT', 'WECHAT_PUBLISH'].includes(action.kind) && action.status === 'PENDING').length,
    },
  };
}
