import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksUnapprovedFullOverwrite, explicitlyAllowsFullRewrite } from './workspace-write-policy.mjs';

test('blocks write_file from replacing an existing file without approval', () => {
  const existing = new Set(['index.html']);
  assert.equal(blocksUnapprovedFullOverwrite('index.html', existing, '继续完善现有页面'), true);
  assert.equal(blocksUnapprovedFullOverwrite('new.html', existing, '创建一个页面'), false);
});

test('allows an explicitly approved full rewrite', () => {
  assert.equal(explicitlyAllowsFullRewrite('从头重做并整体覆盖 index.html'), true);
  assert.equal(blocksUnapprovedFullOverwrite('index.html', new Set(['index.html']), '从头重做并整体覆盖 index.html'), false);
});
