export function latestRunInRetryChain(runs = [], rootRunId) {
  if (!rootRunId) return null;
  const byId = new Map(runs.map((run) => [run.id, run]));
  const belongsToChain = (run) => {
    const visited = new Set();
    let current = run;
    while (current && !visited.has(current.id)) {
      if (current.id === rootRunId) return true;
      visited.add(current.id);
      current = current.retryOfId ? byId.get(current.retryOfId) : null;
    }
    return false;
  };
  return runs
    .filter(belongsToChain)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0] || null;
}
