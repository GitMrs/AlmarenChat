import test from 'node:test';
import assert from 'node:assert/strict';
import { agentMemoryContext, agentMemoryRuleKey, correctionMemoryCandidate, selectAgentMemory } from './agent-memory-policy.mjs';

test('agent memory selects only active rules and accepted experiences', () => {
  const selected = selectAgentMemory({
    query: '公众号文章排版',
    rules: [
      { id: 'active', status: 'ACTIVE', category: 'method', title: '公众号', instruction: '公众号文章使用微信兼容排版' },
      { id: 'pending', status: 'PENDING', category: 'correction', title: '待确认', instruction: '不能进入上下文' },
    ],
    experiences: [
      { id: 'accepted', outcome: 'ACCEPTED', title: '公众号文章', summary: '完成微信排版' },
      { id: 'failed', outcome: 'FAILED', title: '失败任务', summary: '不能进入上下文' },
    ],
  });
  assert.deepEqual(selected.rules.map((item) => item.id), ['active']);
  assert.deepEqual(selected.experiences.map((item) => item.id), ['accepted']);
});

test('agent memory context includes confirmed rules but not automatic historical evidence', () => {
  const context = agentMemoryContext({
    query: '网页',
    rules: [{ status: 'ACTIVE', category: 'correction', instruction: '禁止重复读取同一个完整文件' }],
    experiences: [{ outcome: 'ACCEPTED', title: '专题网页', summary: '完成单文件 HTML' }],
  });
  assert.match(context, /已确认工作经验/);
  assert.doesNotMatch(context, /完成单文件 HTML/);
});

test('agent correction candidates are deterministic and retain evidence ids', () => {
  const candidate = correctionMemoryCandidate({ feedback: '先确认目标受众', taskId: 'task-1', runId: 'run-1' });
  assert.equal(candidate.key, agentMemoryRuleKey('correction', candidate.instruction));
  assert.deepEqual(candidate.sourceIds, ['task-1', 'run-1']);
});
