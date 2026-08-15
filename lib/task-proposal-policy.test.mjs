import assert from 'node:assert/strict';
import test from 'node:test';
import { taskProposalNeedsClarification } from './task-proposal-policy.mjs';

test('task proposals cannot defer required user clarification to the worker', () => {
  assert.equal(taskProposalNeedsClarification('', ['确认用户持有的是哪类黄金']), true);
  assert.equal(taskProposalNeedsClarification('', ['等待用户补充 4430 的单位']), true);
  assert.equal(taskProposalNeedsClarification('联网核实当前黄金价格', ['查询权威来源并记录时间和单位']), false);
});
