import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSharedWorkspacePath,
  logicalWorkspaceRelativePath,
  storedWorkspaceRelativePath,
  workspaceFileWorkId,
} from './space-work-paths.mjs';

test('work paths keep logical names while storing files below the work directory', () => {
  const stored = storedWorkspaceRelativePath('work-1', 'article.md');
  assert.equal(stored, 'workspace/works/work-1/article.md');
  assert.equal(logicalWorkspaceRelativePath('work-1', stored), 'article.md');
  assert.equal(storedWorkspaceRelativePath(null, 'article.md'), 'workspace/article.md');
});

test('shared paths stay at space scope instead of being stored below a work', () => {
  assert.equal(isSharedWorkspacePath('shared/content-strategy.md'), true);
  assert.equal(storedWorkspaceRelativePath('work-1', 'shared/content-strategy.md'), 'workspace/shared/content-strategy.md');
  assert.equal(workspaceFileWorkId('work-1', 'shared/content-strategy.md'), null);
});

test('work path conversion rejects another work directory', () => {
  assert.throws(
    () => logicalWorkspaceRelativePath('work-1', 'workspace/works/work-2/article.md'),
    /不属于当前 Work/
  );
});
