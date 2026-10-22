export const TERMINAL_RUN_STATUSES = new Set([
  'COMPLETED',
  'PARTIAL',
  'FAILED_VALIDATION',
  'FAILED',
  'BLOCKED',
  'CANCELLED',
]);

export function completionIdFor(runId) {
  return `run-completion:${runId}`;
}

export function completionMessage(payload) {
  const result = String(payload.result || '').trim();
  const error = String(payload.error || '').trim();
  if (payload.status === 'COMPLETED') return result || '任务已完成。';
  if (payload.status === 'PARTIAL') return `任务已部分完成。${result ? `\n\n${result}` : ''}`;
  if (payload.status === 'FAILED_VALIDATION') return `任务产出未通过验收。${result ? `\n\n${result}` : ''}`;
  if (payload.status === 'BLOCKED') return `任务缺少必要条件，暂时无法继续。${error ? `\n\n${error}` : ''}`;
  if (payload.status === 'CANCELLED') return '任务已取消。';
  return `任务执行失败。${error ? `\n\n${error}` : ''}`;
}
