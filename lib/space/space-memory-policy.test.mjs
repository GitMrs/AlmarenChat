import assert from 'node:assert/strict';
import test from 'node:test';
import { appendSpaceMemory, spaceMemoryContext } from './space-memory-policy.mjs';

test('space memory keeps recent activity and rolls older activity into summaries', () => {
  const activities = Array.from({ length: 20 }, (_, index) => ({
    type: 'message',
    actor: index % 2 ? 'Agent' : '用户',
    summary: `活动 ${index}`,
    at: `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`,
  }));
  const memory = appendSpaceMemory(null, activities);
  assert.equal(memory.recentActivity.length, 12);
  assert.match(memory.rollingSummary, /活动 0/);
  assert.match(spaceMemoryContext(memory), /最近活动/);
  assert.equal(memory.activityCount, 20);
});

test('space memory remains bounded while preserving historical context', () => {
  let memory = null;
  for (let batch = 0; batch < 20; batch += 1) {
    memory = appendSpaceMemory(memory, Array.from({ length: 12 }, (_, index) => ({
      summary: `批次 ${batch} 活动 ${index} ${'x'.repeat(100)}`,
      at: new Date(2026, 0, batch + 1).toISOString(),
    })));
  }
  assert.ok(memory.rollingSummary.length <= 6_000);
  assert.ok(memory.historySummary.length <= 12_000);
  assert.equal(memory.recentActivity.length, 12);
  assert.equal(memory.activityCount, 240);
});

test('trusted memory policy marker stays internal and survives activity rollover', () => {
  let memory = appendSpaceMemory(null, [{
    type: 'memory_policy',
    actor: '系统',
    summary: '可信记忆策略',
    refId: 'trusted-space-memory-v2',
  }]);
  memory = appendSpaceMemory(memory, Array.from({ length: 30 }, (_, index) => ({ summary: `活动 ${index}` })));
  assert.ok(memory.recentActivity.some((activity) => activity.refId === 'trusted-space-memory-v2'));
  assert.doesNotMatch(spaceMemoryContext(memory), /可信记忆策略/);
});
