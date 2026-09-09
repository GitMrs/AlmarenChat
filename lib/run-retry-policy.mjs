function coordinatorState(run) {
  return run?.coordinatorState && typeof run.coordinatorState === 'object'
    ? run.coordinatorState
    : null;
}

function jsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function taskKey(task) {
  return `${String(task?.title || '')}\n${String(task?.instruction || '')}`;
}

function appliedManifest(task) {
  return Array.isArray(task?.artifactManifests)
    ? task.artifactManifests.find((manifest) => {
        const validation = jsonValue(manifest?.validation, {});
        return manifest?.attempt === task?.attempt
          && manifest?.status === 'APPLIED'
          && validation?.valid !== false;
      }) || null
    : null;
}

export function retryContextFromRuns(runs = []) {
  const states = runs.map(coordinatorState).filter(Boolean);
  const authorizationState = states.find((state) => state.authorization && typeof state.authorization === 'object') || null;
  const automationState = states.find((state) => state.automated === true && typeof state.automationId === 'string') || null;
  const allTasks = runs.flatMap((run) => Array.isArray(run?.tasks) ? run.tasks : []);
  const seen = new Set();
  const completedEntries = [];
  for (const task of allTasks) {
    if (task?.status !== 'COMPLETED' || task?.reviewDecision !== 'accept') continue;
    const key = taskKey(task);
    if (seen.has(key)) continue;
    seen.add(key);
    let manifest = appliedManifest(task);
    if (!manifest && task?.origin === 'retry_inherited') {
      const source = allTasks.find((candidate) =>
        candidate?.id !== task.id
        && taskKey(candidate) === key
        && candidate?.result === task.result
        && candidate?.status === 'COMPLETED'
        && candidate?.reviewDecision === 'accept'
        && appliedManifest(candidate)
      );
      manifest = source ? appliedManifest(source) : null;
    }
    if (task?.mode !== 'advisor' && !manifest) continue;
    completedEntries.push({ task, manifest });
  }

  return {
    authorization: authorizationState?.authorization || null,
    automated: Boolean(automationState),
    automationId: automationState?.automationId || null,
    completedEntries,
    completedTasks: completedEntries.map((entry) => entry.task),
  };
}
