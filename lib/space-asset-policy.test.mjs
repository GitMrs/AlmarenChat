import test from 'node:test';
import assert from 'node:assert/strict';
import { spaceAssetRole, spaceAssetRoleLabel } from './space-asset-policy.mjs';

test('classifies shared space asset paths consistently', () => {
  assert.equal(spaceAssetRole('workspace/foundation/account-profile.md'), 'FOUNDATION');
  assert.equal(spaceAssetRole('workspace/inbox/source.md'), 'INPUT');
  assert.equal(spaceAssetRole('workspace/shared/topic-pool.md'), 'SHARED');
  assert.equal(spaceAssetRole('workspace/works/work-1/article.md', 'work-1'), 'OUTPUT');
  assert.equal(spaceAssetRole('files/upload.pdf'), 'INPUT');
  assert.equal(spaceAssetRole('.space/skills/creator/SKILL.md'), 'SKILL');
});

test('provides stable labels for the file UI', () => {
  assert.equal(spaceAssetRoleLabel('FOUNDATION'), '基础资料');
  assert.equal(spaceAssetRoleLabel('unknown'), '空间文件');
});
