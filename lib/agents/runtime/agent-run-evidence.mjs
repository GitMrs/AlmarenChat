function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return fallback;
  }
}

function manifestEvidence(manifests) {
  const appliedEntries = [];
  const stagedEntries = [];
  const checks = [];
  for (const manifest of manifests || []) {
    const parsedEntries = parseJson(manifest?.entries, []);
    const validation = parseJson(manifest?.validation, {});
    if (Array.isArray(parsedEntries)) {
      if (manifest?.status === 'APPLIED') appliedEntries.push(...parsedEntries);
      else stagedEntries.push(...parsedEntries);
    }
    if (Array.isArray(validation?.checks)) checks.push(...validation.checks);
  }
  return { appliedEntries, stagedEntries, checks };
}

function toolEvidence(events) {
  const counts = new Map();
  for (const event of events || []) {
    if (event?.type !== 'TOOL_COMPLETED') continue;
    const payload = parseJson(event.payload, {});
    const tool = String(payload?.tool || '').trim();
    if (tool) counts.set(tool, (counts.get(tool) || 0) + 1);
  }
  return [...counts.entries()].map(([tool, count]) => `${tool}×${count}`);
}

export function summarizeRunEvidence(run) {
  const { appliedEntries, stagedEntries, checks } = manifestEvidence(run?.artifactManifests);
  const changedPaths = [...new Set(appliedEntries.map((entry) => String(entry?.path || '')).filter(Boolean))];
  const stagedPaths = [...new Set(stagedEntries.map((entry) => String(entry?.path || '')).filter(Boolean))];
  const acceptedCount = (run?.taskCompletions || []).filter((item) => item?.status === 'ACCEPTED').length;
  const tools = toolEvidence(run?.events);
  return {
    id: String(run?.id || ''),
    status: String(run?.status || ''),
    input: String(run?.input || ''),
    result: String(run?.result || ''),
    error: String(run?.error || ''),
    fileChangeCount: changedPaths.length,
    changedPaths,
    stagedChangeCount: stagedPaths.length,
    stagedPaths,
    validationCheckCount: checks.length,
    acceptedTaskCount: acceptedCount,
    tools,
  };
}

export function recentRunEvidenceContext(runs) {
  const summaries = (Array.isArray(runs) ? runs : []).map(summarizeRunEvidence);
  if (summaries.length === 0) return '';
  const blocks = summaries.map((run) => {
    const lines = [
      `Run ${run.id}：${run.status}`,
      `目标：${run.input.slice(0, 500)}`,
      `文件变更：${run.fileChangeCount}${run.changedPaths.length > 0 ? `（${run.changedPaths.slice(0, 20).join('、')}）` : '（无）'}`,
      `未应用的暂存变更：${run.stagedChangeCount}${run.stagedPaths.length > 0 ? `（${run.stagedPaths.slice(0, 20).join('、')}）` : '（无）'}`,
      `自动校验：${run.validationCheckCount} 项`,
      `已验收任务：${run.acceptedTaskCount} 项`,
      `工具记录：${run.tools.length > 0 ? run.tools.join('、') : '无'}`,
    ];
    if (run.error) lines.push(`错误：${run.error.slice(0, 800)}`);
    if (run.status === 'COMPLETED' && run.result) lines.push(`已验证结果：${run.result.slice(0, 800)}`);
    return lines.join('\n');
  });
  return `最近后台任务的结构化执行证据如下。它优先于聊天中的助手陈述：\n\n${blocks.join('\n\n')}\n\n事实约束：文件变更为 0 时不得声称已写入、更新或覆盖文件；自动校验为 0 时不得声称已完成静态校验；没有已验收任务时不得声称成果已通过验收。`;
}
