import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldRefreshResearch } from './research-policy.mjs';

test('refreshes research only when the review explicitly asks for new research', () => {
  assert.equal(shouldRefreshResearch('请重新搜索，这次优先官方来源'), true);
  assert.equal(shouldRefreshResearch('更新一下资料和来源'), true);
  assert.equal(shouldRefreshResearch('再查一下这个概念'), true);
  assert.equal(shouldRefreshResearch('结论写偏了，请按照已经确认的资料修改'), false);
  assert.equal(shouldRefreshResearch('页面样式需要调整'), false);
  assert.equal(shouldRefreshResearch(''), false);
});
