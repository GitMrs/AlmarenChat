import assert from 'node:assert/strict';
import test from 'node:test';
import { formatWorkspaceInventory } from './workspace-inventory-policy.mjs';

test('workspace inventory distinguishes empty and existing files', () => {
  assert.equal(formatWorkspaceInventory([]), '当前空间工作区为空。');
  assert.match(
    formatWorkspaceInventory([{ path: 'mortgage-calculator.html' }, { path: 'docs/requirements.md' }]),
    /mortgage-calculator\.html[\s\S]*docs\/requirements\.md/
  );
});

test('workspace inventory stays bounded', () => {
  const result = formatWorkspaceInventory(
    [{ path: 'one.md' }, { path: 'two.md' }, { path: 'three.md' }],
    2
  );
  assert.match(result, /其余 1 个文件未展开/);
  assert.doesNotMatch(result, /three\.md/);
});
