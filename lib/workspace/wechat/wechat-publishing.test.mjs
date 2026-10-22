import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractWechatArticleMarkdown,
  isWechatPublishableMarkdownFile,
  splitWechatArticleMarkdown,
} from './wechat-publishing.mjs';

test('wechat publishing identifies article files and excludes supporting documents', () => {
  assert.equal(isWechatPublishableMarkdownFile('article.md'), true);
  assert.equal(isWechatPublishableMarkdownFile('ai_knowledge_base_guide.md'), true);
  assert.equal(isWechatPublishableMarkdownFile('publish-info.md'), false);
  assert.equal(isWechatPublishableMarkdownFile('README.md'), false);
  assert.equal(isWechatPublishableMarkdownFile('资料/来源清单.md'), false);
  assert.equal(isWechatPublishableMarkdownFile('文章大纲.md'), false);
  assert.equal(isWechatPublishableMarkdownFile('index.html'), false);
});

test('wechat publishing removes a legacy title and summary prelude', () => {
  const markdown = [
    '# 备选标题与文章摘要',
    '',
    '## 5 个备选标题',
    '1. 标题甲',
    '',
    '# 最终文章标题',
    '',
    '正式正文。',
  ].join('\n');

  assert.equal(extractWechatArticleMarkdown(markdown), '# 最终文章标题\n\n正式正文。');
});

test('wechat publishing keeps an article that already starts with its final title', () => {
  const markdown = '# 最终文章标题\n\n正式正文。';
  assert.equal(extractWechatArticleMarkdown(markdown), markdown);
});

test('wechat publishing handles empty input', () => {
  assert.equal(extractWechatArticleMarkdown('  '), '');
});

test('wechat publishing separates the title from the editor body', () => {
  assert.deepEqual(splitWechatArticleMarkdown('# 最终文章标题\n\n第一段。\n\n第二段。'), {
    title: '最终文章标题',
    body: '第一段。\n\n第二段。',
  });
});
