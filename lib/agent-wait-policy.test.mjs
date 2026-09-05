import assert from 'node:assert/strict';
import test from 'node:test';
import { canResumeWaiting, isExecutionBudgetWait, normalizeWaitRequest, validateWaitAnswer } from './agent-wait-policy.mjs';

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
