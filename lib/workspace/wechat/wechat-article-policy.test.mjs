import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWechatArticleImage, selectAutomatedWechatDraftFiles, wechatDraftSnapshotHash } from './wechat-article-policy.mjs';

const files = [{ id: 'image-1', fileName: '封面.png', relativePath: 'workspace/works/work-1/assets/封面.png', mimeType: 'image/png' }];

test('wechat article images resolve only to registered local space images', () => {
  assert.equal(resolveWechatArticleImage('assets/%E5%B0%81%E9%9D%A2.png', files).id, 'image-1');
  assert.throws(() => resolveWechatArticleImage('https://example.com/image.png', files), /暂不支持外部或内联图片/);
  assert.throws(() => resolveWechatArticleImage('../封面.png', files), /路径不安全/);
  assert.throws(() => resolveWechatArticleImage('missing.png', files), /不存在/);
});

test('automated drafts select exactly one article and prefer an explicitly named cover', () => {
  const workFiles = [
    { id: 'article', workId: 'work-1', status: 'READY', fileName: 'article.md', mimeType: 'text/markdown' },
    { id: 'inline', workId: 'work-1', status: 'READY', fileName: 'chart.png', mimeType: 'image/png' },
    { id: 'cover', workId: 'work-1', status: 'READY', fileName: 'cover-main.png', mimeType: 'image/png' },
    { id: 'other-work', workId: 'work-2', status: 'READY', fileName: 'other.md', mimeType: 'text/markdown' },
  ];
  const selected = selectAutomatedWechatDraftFiles(workFiles, 'work-1');
  assert.equal(selected.articleFile.id, 'article');
  assert.equal(selected.coverFile.id, 'cover');
  assert.equal(selected.workFiles.length, 3);
});

test('automated drafts reject ambiguous articles and covers', () => {
  const article = { workId: 'work-1', status: 'READY', mimeType: 'text/markdown' };
  const image = { workId: 'work-1', status: 'READY', mimeType: 'image/png' };
  assert.throws(() => selectAutomatedWechatDraftFiles([
    { ...article, id: 'a', fileName: 'a.md' },
    { ...article, id: 'b', fileName: 'b.md' },
    { ...image, id: 'cover', fileName: 'cover.png' },
  ], 'work-1'), /多篇/);
  assert.throws(() => selectAutomatedWechatDraftFiles([
    { ...article, id: 'a', fileName: 'a.md' },
    { ...image, id: 'one', fileName: 'one.png' },
    { ...image, id: 'two', fileName: 'two.png' },
  ], 'work-1'), /多张图片/);
});

test('wechat draft snapshot hashes are deterministic and content-sensitive', () => {
  const snapshot = { title: '标题', html: '<p>正文</p>', assets: [{ fileId: 'cover', sha256: 'abc' }] };
  assert.equal(wechatDraftSnapshotHash(snapshot), wechatDraftSnapshotHash(snapshot));
  assert.notEqual(wechatDraftSnapshotHash(snapshot), wechatDraftSnapshotHash({ ...snapshot, html: '<p>修改</p>' }));
});
