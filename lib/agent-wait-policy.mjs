export const EXECUTION_BUDGET_WAIT_REASON = 'execution_iteration_budget';
export const RUN_BUDGET_WAIT_ERROR = 'run_model_request_budget';
export const DEFAULT_CONTINUATION_ITERATIONS = 10;
export const MAX_CONTINUATION_ITERATIONS = 50;
const CONTINUATION_ANSWER_PREFIX = 'execution_continue:';

export function isExecutionBudgetWait(value) {
  return value === EXECUTION_BUDGET_WAIT_REASON;
}

export function isRunBudgetWait(value) {
  return value === RUN_BUDGET_WAIT_ERROR;
}

export function validateContinuationIterations(value) {
  const iterations = Number(value ?? DEFAULT_CONTINUATION_ITERATIONS);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_CONTINUATION_ITERATIONS) {
    return { iterations: 0, error: `继续执行轮次必须是 1 到 ${MAX_CONTINUATION_ITERATIONS} 之间的整数` };
  }
  return { iterations, error: '' };
}

export function executionContinuationAnswer(iterations) {
  return `${CONTINUATION_ANSWER_PREFIX}${iterations}`;
}

export function continuationIterationsFromAnswer(value) {
  const matched = String(value || '').match(/^execution_continue:(\d+)$/);
  if (!matched) return null;
  const validation = validateContinuationIterations(Number(matched[1]));
  return validation.error ? null : validation.iterations;
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
