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

test('shared Markdown keeps safe relative image assets', () => {
  const html = renderSharedMarkdownPage('![封面](assets/cover.jpg)\n\n![越界](../secret.jpg)');
  assert.match(html, /src="assets\/cover\.jpg"/);
  assert.doesNotMatch(html, /secret\.jpg/);
});

test('editorial notebook layout turns structured Markdown into safe news cards', () => {
  const html = renderSharedMarkdownPage(`---
layout: editorial-notebook
title: 今日观察
date: 2026 年 9 月 23 日
intro: 今天值得关注的几个变化。
---

## 科技与产品

### 浏览器能力正在变得更实用

文件和轻量计算逐渐在浏览器内完成。

发布作者：Web Platform
链接：https://example.com/news
`, 'daily-report.md');
  assert.match(html, /今日观察/);
  assert.match(html, /科技与产品/);
  assert.match(html, /浏览器能力正在变得更实用/);
  assert.match(html, /class="card"/);
  assert.match(html, /href="https:\/\/example\.com\/news"/);
  assert.match(html, /@keyframes rise/);
});

test('ordinary Markdown keeps the default shared layout', () => {
  const html = renderSharedMarkdownPage('# 普通文档\n\n正文');
  assert.match(html, /<article>/);
  assert.doesNotMatch(html, /class="masthead"/);
});
