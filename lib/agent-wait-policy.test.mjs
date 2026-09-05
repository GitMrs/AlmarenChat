import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canResumeWaiting,
  continuationIterationsFromAnswer,
  executionContinuationAnswer,
  isExecutionBudgetWait,
  isRunBudgetWait,
  normalizeWaitRequest,
  validateContinuationIterations,
  validateWaitAnswer,
} from './agent-wait-policy.mjs';

test('wait requests require one concrete question and reason', () => {
  assert.deepEqual(normalizeWaitRequest({ question: '使用哪个地区？', reason: '价格因地区不同' }), {
    question: '使用哪个地区？',
    reason: '价格因地区不同',
  });
  assert.throws(() => normalizeWaitRequest({ question: '', reason: '缺少地区' }), /具体问题/);
  assert.throws(() => normalizeWaitRequest({ question: '使用哪个地区？', reason: '' }), /阻塞原因/);
});

test('waiting resume requires an answer and matching run and task states', () => {
  assert.deepEqual(validateWaitAnswer('  新加坡  '), { answer: '新加坡', error: '' });
  assert.match(validateWaitAnswer(' ').error, /请填写/);
  assert.match(validateWaitAnswer('x'.repeat(4_001)).error, /4000/);
  assert.equal(canResumeWaiting('WAITING', 'WAITING'), true);
  assert.equal(canResumeWaiting('FAILED', 'WAITING'), false);
  assert.equal(canResumeWaiting('WAITING', 'RUNNING'), false);
});

test('execution budget waits are distinguishable from missing user input', () => {
  assert.equal(isExecutionBudgetWait('execution_iteration_budget'), true);
  assert.equal(isExecutionBudgetWait('计算方法取决于用户选择'), false);
});

test('continuation iterations are bounded integers and round-trip through the internal answer', () => {
  assert.deepEqual(validateContinuationIterations(1), { iterations: 1, error: '' });
  assert.deepEqual(validateContinuationIterations(10), { iterations: 10, error: '' });
  assert.deepEqual(validateContinuationIterations(50), { iterations: 50, error: '' });
  assert.match(validateContinuationIterations(0).error, /1 到 50/);
  assert.match(validateContinuationIterations(51).error, /1 到 50/);
  assert.match(validateContinuationIterations(1.5).error, /整数/);
  assert.equal(executionContinuationAnswer(30), 'execution_continue:30');
  assert.equal(continuationIterationsFromAnswer('execution_continue:30'), 30);
  assert.equal(continuationIterationsFromAnswer('execution_continue:100'), null);
});

test('run budget waits are distinguishable from ordinary run errors', () => {
  assert.equal(isRunBudgetWait('run_model_request_budget'), true);
  assert.equal(isRunBudgetWait('provider unavailable'), false);
});
