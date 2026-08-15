export const MAX_MUTATIONS_PER_PATH_BEFORE_CHECK = 4;

function toolName(tool) {
  return String(tool?.function?.name || '');
}

export function createExecutionConvergence(maxMutations = MAX_MUTATIONS_PER_PATH_BEFORE_CHECK) {
  const mutationCounts = new Map();
  const mutatedPaths = new Set();
  const validatedPaths = new Set();
  const requiredChecks = new Set();

  return {
    availableTools(tools) {
      const complete = mutatedPaths.size > 0 && [...mutatedPaths].every((path) => validatedPaths.has(path));
      if (complete) return [];
      if (requiredChecks.size === 0) return tools;
      return tools
        .filter((tool) => toolName(tool) === 'check_files')
        .map((tool) => ({
          ...tool,
          function: {
            ...tool.function,
            description: `连续修改已达到收敛阈值。请立即检查这些文件后结束当前步骤：${[...requiredChecks].join('、')}`,
          },
        }));
    },

    recordTool(name, args, result) {
      if (['write_file', 'patch_file'].includes(name) && result?.ok !== false) {
        const path = String(args?.path || '').trim();
        if (!path) return;
        mutatedPaths.add(path);
        validatedPaths.delete(path);
        const count = (mutationCounts.get(path) || 0) + 1;
        mutationCounts.set(path, count);
        if (count >= maxMutations) requiredChecks.add(path);
        return;
      }

      if (name !== 'check_files') return;
      const paths = [...new Set((Array.isArray(args?.paths) ? args.paths : []).map(String))];
      for (const path of paths) {
        if (result?.valid) {
          validatedPaths.add(path);
          requiredChecks.delete(path);
        } else {
          validatedPaths.delete(path);
          requiredChecks.delete(path);
        }
      }
    },
  };
}
