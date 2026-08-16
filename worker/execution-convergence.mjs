export const MAX_MUTATIONS_PER_PATH_BEFORE_FINALIZATION = 4;

function toolName(tool) {
  return String(tool?.function?.name || '');
}

export function createExecutionConvergence(maxMutations = MAX_MUTATIONS_PER_PATH_BEFORE_FINALIZATION) {
  const mutationCounts = new Map();
  const mutatedPaths = new Set();
  const validatedPaths = new Set();
  const forcedFinalizationPaths = new Set();

  return {
    availableTools(tools) {
      const complete = mutatedPaths.size > 0 && [...mutatedPaths].every((path) => validatedPaths.has(path));
      if (complete) return [];
      if (forcedFinalizationPaths.size > 0) return [];
      return tools;
    },

    recordTool(name, args, result) {
      if (['write_file', 'patch_file'].includes(name) && result?.ok !== false) {
        const path = String(args?.path || '').trim();
        if (!path) return;
        mutatedPaths.add(path);
        validatedPaths.delete(path);
        const count = (mutationCounts.get(path) || 0) + 1;
        mutationCounts.set(path, count);
        if (count >= maxMutations) forcedFinalizationPaths.add(path);
        return;
      }

      if (name !== 'check_files') return;
      const paths = [...new Set((Array.isArray(args?.paths) ? args.paths : []).map(String))];
      for (const path of paths) {
        if (result?.valid) {
          validatedPaths.add(path);
          forcedFinalizationPaths.delete(path);
        } else {
          validatedPaths.delete(path);
          forcedFinalizationPaths.delete(path);
        }
      }
    },
  };
}
