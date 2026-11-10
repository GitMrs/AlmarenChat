import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { isWechatWorkspace, spaceWorkspaceHref } from './wechat-workspace.mjs';
import { normalizeAutomationCompletion } from '../../space/space-automation-policy.mjs';

test('new and legacy WeChat spaces share the dedicated route without changing other spaces', () => {
  for (const space of [{ id: 'new', workspaceType: 'WECHAT' }, { id: 'old', templateId: 'wechat-article' }]) {
    assert.equal(isWechatWorkspace(space), true);
    assert.equal(spaceWorkspaceHref(space), `/wechat/${space.id}`);
    assert.equal(normalizeAutomationCompletion({ completionAction: 'WECHAT_CREATE_DRAFT' }, space).completionAction, 'WECHAT_CREATE_DRAFT');
  }
  for (const templateId of [null, 'crypto-contract-trading', 'bilibili-creator']) {
    const space = { id: 'ordinary', templateId, workspaceType: 'GENERAL' };
    assert.equal(isWechatWorkspace(space), false);
    assert.equal(spaceWorkspaceHref(space), '/spaces/ordinary');
    assert.throws(() => normalizeAutomationCompletion({ completionAction: 'WECHAT_CREATE_DRAFT' }, space), /只有公众号/);
  }
  assert.equal(isWechatWorkspace(null), false);
});

test('migration identifies only legacy WeChat spaces and preserves existing records', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE Space (id TEXT PRIMARY KEY, templateId TEXT, instructions TEXT)');
    const insert = db.prepare('INSERT INTO Space VALUES (?, ?, ?)');
    for (const [id, templateId] of [['wechat', 'wechat-article'], ['crypto', 'crypto-contract-trading'], ['bili', 'bilibili-creator'], ['plain', null]]) insert.run(id, templateId, `${id}-custom-rules`);
    db.exec(readFileSync(new URL('../../../prisma/migrations/20261109090000_add_wechat_workspace_type/migration.sql', import.meta.url), 'utf8'));
    for (const row of db.prepare('SELECT * FROM Space').all()) {
      assert.equal(row.workspaceType, row.id === 'wechat' ? 'WECHAT' : 'GENERAL');
      assert.equal(row.instructions, `${row.id}-custom-rules`);
    }
  } finally { db.close(); }
});
