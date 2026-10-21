import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

async function loadKnowledgeModule() {
  const filePath = path.resolve(process.cwd(), 'lib/knowledge.ts');
  const source = await readFile(filePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;

  const exports = {};
  const context = {
    exports,
    module: { exports },
    console,
    process,
    require: (name) => {
      if (name === 'node:path' || name === 'path') return path;
      if (name === 'node:fs' || name === 'fs') return fs;
      if (name.includes('local-embeddings')) {
        return { embedText: async () => [0.1, 0.2] };
      }
      if (name.includes('db')) {
        return { default: {} };
      }
      return {};
    },
  };
  vm.createContext(context);
  vm.runInContext(output, context);
  return context.module.exports;
}

test('splitTextMarkdownAware returns empty for empty input', async () => {
  const { splitTextMarkdownAware } = await loadKnowledgeModule();
  assert.equal(splitTextMarkdownAware('').length, 0);
  assert.equal(splitTextMarkdownAware('   \n\n  ').length, 0);
});

test('splitTextMarkdownAware coalesces short title, summary, and key points into an intact knowledge card', async () => {
  const { splitTextMarkdownAware } = await loadKnowledgeModule();
  const markdown = `# 断舍离实践经验：分区清理、取舍标准与物品归位方法
> 来源：少数派 | https://sspai.com/post/115209 | 研习日期：2026-10-21 | 分类：生活

## 摘要
文章系统分享了作者多年断舍离的实践流程，包括按房间分区、安排整理时间、判断物品去留。

## 关键要点
- 整理前先分区并安排固定时间，降低心智负担。
- 取舍采用通用标准，遵循低维护成本原则。`;

  const chunks = splitTextMarkdownAware(markdown);
  assert.ok(chunks.length >= 1 && chunks.length <= 2, `Expected 1-2 chunks, got ${chunks.length}`);
  assert.match(chunks[0].text, /## 摘要/);
  assert.match(chunks[0].text, /整理前先分区/);
});

test('splitTextMarkdownAware respects sentence boundaries for long text and never cuts words in half', async () => {
  const { splitTextMarkdownAware } = await loadKnowledgeModule();
  const longSentenceDoc = `# 系统架构设计

## 核心原理
第一句话介绍系统架构设计的基本思想与原理。第二句话详细阐述如何在分布式环境下保证数据一致性与高可用性。第三句话深入分析事务隔离级别以及在数据库负载剧烈波动时的自适应限流策略。第四句话总结如何在不牺牲吞吐量的前提下实现亚毫秒级响应延迟。第五句话提供具体的基准测试数据与生产环境落地最佳实践指南。第六句话讲述后续扩展性与多区域容灾部署方案。`;

  const chunks = splitTextMarkdownAware(longSentenceDoc);
  for (const chunk of chunks) {
    assert.match(chunk.text, /[。！？\n]$/);
  }
});

test('splitTextMarkdownAware filters out meaningless separator lines', async () => {
  const { splitTextMarkdownAware } = await loadKnowledgeModule();
  const doc = `# 标题
---
## 小节
内容`;
  const chunks = splitTextMarkdownAware(doc);
  assert.ok(chunks.every((c) => c.text !== '---'));
});
