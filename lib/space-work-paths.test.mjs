import assert from 'node:assert/strict';
import test from 'node:test';
import {
  logicalWorkspaceRelativePath,
  storedWorkspaceRelativePath,
} from './space-work-paths.mjs';

test('work paths keep logical names while storing files below the work directory', () => {
  const stored = storedWorkspaceRelativePath('work-1', 'article.md');
  assert.equal(stored, 'workspace/works/work-1/article.md');
  assert.equal(logicalWorkspaceRelativePath('work-1', stored), 'article.md');
  assert.equal(storedWorkspaceRelativePath(null, 'article.md'), 'workspace/article.md');
});

test('work path conversion rejects another work directory', () => {
  assert.throws(
    () => logicalWorkspaceRelativePath('work-1', 'workspace/works/work-2/article.md'),
    /不属于当前 Work/
  );
});
