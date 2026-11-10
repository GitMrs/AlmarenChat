import assert from 'node:assert/strict';
import test from 'node:test';
import { renderWechatArticleBody, renderWechatArticleSnapshot } from './wechat-article-snapshot.mjs';

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

test('preview and draft use identical Unicode, table, quote, code and multi-image markup', () => {
  const body = ['你好 🐱', '', '> 引用', '', '```js', 'const x = "<script>";', '```', '', '| 列 | 长内容 |', '| --- | --- |', '| 一 | 二 |', '', '![图一](one.png)', '', '![图二](two.png)'].join('\n');
  const files = ['one', 'two'].map((id) => ({ id, fileName: `${id}.png`, relativePath: `workspace/${id}.png`, mimeType: 'image/png' }));
  const snapshot = renderWechatArticleSnapshot('# 正式标题\n\n' + body, files, 'editorial-red');
  const preview = renderWechatArticleBody(body, files, 'editorial-red', { one: 'data:image/png;base64,YQ==', two: 'data:image/png;base64,Yg==' });
  assert.equal(preview.html.replace(/ src="data:image\/png;base64,[^"]+"/g, ''), snapshot.html);
  assert.match(preview.html, /table-layout:fixed/);
  assert.match(preview.html, /&lt;script&gt;/);
  assert.deepEqual(preview.embeddedFiles.map((file) => file.id), ['one', 'two']);
  assert.throws(() => renderWechatArticleBody('![不存在](missing.png)', files), /不存在/);
});
