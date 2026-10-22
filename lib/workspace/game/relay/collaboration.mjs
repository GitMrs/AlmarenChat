export function createCollaborationState(completionCriteria = []) {
  return {
    version: 1,
    completionCriteria: Array.isArray(completionCriteria)
      ? completionCriteria.map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
      : [],
    lastAgentId: null,
    lastContent: '',
  };
}
