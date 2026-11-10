import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadWechatContext } from './wechat-context.mjs';

test('wechat context shares strategy but reads only the selected article and latest objective', (t) => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'wechat-context-'));
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  const root = path.join(projectRoot, 'data/spaces/user/space/workspace');
  mkdirSync(path.join(root, 'shared'), { recursive: true });
  writeFileSync(path.join(root, 'shared/content-strategy.md'), '面向新手，口语化');
  for (const id of ['first', 'second']) {
    mkdirSync(path.join(root, 'works', id), { recursive: true });
    writeFileSync(path.join(root, 'works', id, 'article.md'), `# ${id} 正文`);
  }
  const options = { projectRoot, userId: 'user', space: { id: 'space', workspaceType: 'WECHAT' } };
  const first = loadWechatContext({ ...options, work: { id: 'first', spaceId: 'space', title: '第一篇', objective: '只改开头' } });
  assert.match(first, /面向新手，口语化/);
  assert.match(first, /只改开头/);
  assert.match(first, /first 正文/);
  assert.doesNotMatch(first, /second 正文/);
  const second = loadWechatContext({ ...options, work: { id: 'second', spaceId: 'space', title: '第二篇' } });
  assert.match(second, /面向新手，口语化/);
  assert.doesNotMatch(second, /first 正文/);
  assert.doesNotMatch(loadWechatContext(options), /first 正文|second 正文/);
  writeFileSync(path.join(root, 'shared/content-strategy.md'), '修改后的定位');
  assert.match(loadWechatContext(options), /修改后的定位/);
});

test('wechat context skips other space types and rejects mismatched or unsafe ids', () => {
  assert.equal(loadWechatContext({ space: { id: 'ordinary' } }), '');
  const options = { projectRoot: tmpdir(), userId: 'user', space: { id: 'space', templateId: 'wechat-article' } };
  assert.throws(() => loadWechatContext({ ...options, work: { id: 'article', spaceId: 'other' } }), /不属于/);
  assert.throws(() => loadWechatContext({ ...options, userId: '../outside' }), /不安全/);
  assert.match(loadWechatContext(options), /当前未选择文章/);
});

test('wechat context bounds large files and explicitly marks incomplete source', (t) => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'wechat-context-limit-'));
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  const root = path.join(projectRoot, 'data/spaces/user/space/workspace/works/article');
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, 'article.md'), '长文'.repeat(100000));
  const context = loadWechatContext({ projectRoot, userId: 'user', space: { id: 'space', workspaceType: 'WECHAT' }, work: { id: 'article', spaceId: 'space', title: '长文' } });
  assert.ok(context.length < 17000);
  assert.match(context, /仅展示开头/);
});
