import assert from 'node:assert/strict';
import test from 'node:test';
import { renderWechatArticleSnapshot } from './wechat-article-snapshot.mjs';

test('wechat article snapshots render styled safe HTML and controlled space image markers without React', () => {
  const result = renderWechatArticleSnapshot([
    '# 测试文章',
    '',
    '## 小节',
    '',
    '正文 **加粗** <script>alert(1)</script>',
    '',
    '![封面](assets/cover.png)',
    '',
    '| 项目 | 结果 |',
    '| --- | --- |',
    '| 草稿 | 完成 |',
  ].join('\n'), [{
    id: 'cover-1', fileName: 'cover.png', relativePath: 'workspace/assets/cover.png', mimeType: 'image/png',
  }], 'editorial-red');
  assert.equal(result.title, '测试文章');
  assert.match(result.html, /<h2 style=/);
  assert.match(result.html, /<table style=/);
  assert.match(result.html, /data-almaren-space-file="cover-1"/);
  assert.doesNotMatch(result.html, /<script>/);
  assert.deepEqual(result.embeddedFiles.map((file) => file.id), ['cover-1']);
});
