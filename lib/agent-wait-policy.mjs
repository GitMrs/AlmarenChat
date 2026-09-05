export const EXECUTION_BUDGET_WAIT_REASON = 'execution_iteration_budget';

export function isExecutionBudgetWait(value) {
  return value === EXECUTION_BUDGET_WAIT_REASON;
}

export function normalizeWaitRequest(value) {
  const question = String(value?.question || '').trim().slice(0, 1_000);
  const reason = String(value?.reason || '').trim().slice(0, 1_000);
  if (!question) throw new Error('等待用户补充时必须提供具体问题');
  if (!reason) throw new Error('等待用户补充时必须说明阻塞原因');
  return { question, reason };
}

export function validateWaitAnswer(value) {
  const answer = typeof value === 'string' ? value.trim() : '';
  if (!answer) return { answer: '', error: '请填写补充信息' };
  if (answer.length > 4_000) return { answer: '', error: '补充信息不能超过 4000 字' };
  return { answer, error: '' };
}

export function canResumeWaiting(runStatus, taskStatus) {
  return runStatus === 'WAITING' && taskStatus === 'WAITING';
}
