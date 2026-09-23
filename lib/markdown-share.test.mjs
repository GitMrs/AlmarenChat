import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSharedMarkdownPage } from './markdown-share.mjs';

test('shared Markdown renders a mobile reading page with safe external links', () => {
  const html = renderSharedMarkdownPage('# 每日简报\n\n[原文](https://example.com)', 'daily-report.md');
  assert.match(html, /<title>每日简报<\/title>/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, /@media \(max-width: 640px\)/);
});

test('shared Markdown does not execute embedded HTML', () => {
  const html = renderSharedMarkdownPage('# 安全测试\n\n<script>alert(1)</script>\n\n[危险链接](javascript:alert(2))');
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /href="javascript:/);
});

test('shared Markdown renders GFM tables and task lists without React server rendering', () => {
  const html = renderSharedMarkdownPage('- [x] 已完成\n\n| 名称 | 数量 |\n| --- | ---: |\n| 示例 | 2 |');
  assert.match(html, /<input type="checkbox" disabled checked>/);
  assert.match(html, /<table>/);
  assert.match(html, /<td align="right">2<\/td>/);
});
