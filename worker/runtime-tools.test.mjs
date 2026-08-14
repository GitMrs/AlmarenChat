import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assessResearchResult,
  assessResearchSources,
  executeWorkspaceTool,
  normalizeOfficialDomains,
  normalizeSearchQueries,
  researchRequirements,
  searchWeb,
  wantsMarkdownArtifact,
  wantsWebResearch,
  wantsWorkspaceArtifact,
  writeMarkdownArtifact,
} from './runtime-tools.mjs';

test('search queries are deduplicated and limited', () => {
  assert.deepEqual(normalizeSearchQueries(['  one ', 'one', 'two', 'three']), ['one', 'two']);
  assert.deepEqual(normalizeSearchQueries('one'), []);
});

test('official domains are normalized and unsafe values are rejected', () => {
  assert.deepEqual(
    normalizeOfficialDomains(['https://www.openai.com/pricing', 'OPENAI.COM', 'localhost', '127.0.0.1', 'not-a-domain']),
    ['openai.com']
  );
});

test('research source audit enforces primary and freshness evidence', () => {
  const requirements = researchRequirements('对比最新版本和官方价格');
  const audit = assessResearchSources(
    [
      {
        sourceTier: 'C',
        isPrimary: false,
        publishedDate: null,
        extractionStatus: 'extracted',
      },
    ],
    requirements
  );
  assert.equal(requirements.timeSensitive, true);
  assert.equal(requirements.primaryRequired, true);
  assert.equal(requirements.timeRange, 'year');
  assert.equal(researchRequirements('查找今天的公告').timeRange, 'day');
  assert.equal(researchRequirements('整理本周动态').timeRange, 'week');
  assert.equal(researchRequirements('汇总本月新闻').timeRange, 'month');
  assert.equal(researchRequirements('研究历史背景').timeRange, null);
  assert.equal(audit.accepted, false);
  assert.match(audit.issues.join('\n'), /官方或权威/);
  assert.match(audit.issues.join('\n'), /发布日期/);
});

test('research result audit validates citation mapping and conflict disclosure', () => {
  const accepted = assessResearchResult(
    '官方价格为示例值 [1]。\n\n来源：https://docs.example.com/pricing\n\n冲突检查：未发现冲突。',
    [{ url: 'https://docs.example.com/pricing' }, { url: 'https://news.example.net/article' }],
    { timeSensitive: true }
  );
  const rejected = assessResearchResult(
    '结论来自资料 [1] 和 [3]。来源：https://unrelated.example.org',
    [{ url: 'https://docs.example.com/pricing' }, { url: 'https://news.example.net/article' }],
    { timeSensitive: true }
  );

  assert.equal(accepted.accepted, true);
  assert.deepEqual(accepted.citedIndexes, [1]);
  assert.equal(rejected.accepted, false);
  assert.deepEqual(rejected.invalidCitations, [3]);
  assert.match(rejected.issues.join('\n'), /编号对应的 URL/);
  assert.match(rejected.issues.join('\n'), /冲突检查/);
});

test('web research searches official domains and extracts primary pages first', async () => {
  const calls = [];
  const client = {
    async search(query, options) {
      calls.push({ type: 'search', query, options });
      if (options.includeDomains) {
        return {
          results: [
            {
              title: 'Official pricing',
              url: 'https://docs.example.com/pricing',
              content: 'Official summary',
              publishedDate: '2026-08-01',
              score: 0.8,
            },
          ],
        };
      }
      return {
        results: [
          {
            title: 'Third-party article',
            url: 'https://news.example.net/article',
            content: 'Article summary',
            publishedDate: '2026-08-02',
            score: 0.9,
          },
        ],
      };
    },
    async extract(urls, options) {
      calls.push({ type: 'extract', urls, options });
      return {
        results: urls.map((url) => ({ url, title: 'Extracted', rawContent: `Body for ${url}` })),
        failedResults: [],
      };
    },
  };

  const result = await searchWeb(['example pricing'], 'test-key', {
    client,
    officialDomains: ['example.com'],
    requirements: { timeSensitive: true, primaryRequired: true, timeRange: 'year' },
  });

  assert.equal(calls[0].options.timeRange, 'year');
  assert.deepEqual(calls[1].options.includeDomains, ['example.com']);
  assert.equal(calls[1].options.timeRange, undefined);
  assert.equal(calls[2].urls[0], 'https://docs.example.com/pricing');
  assert.equal(result.sources[0].isPrimary, true);
  assert.equal(result.sources[0].sourceTier, 'A');
  assert.equal(result.sources[0].extractionStatus, 'extracted');
  assert.equal(result.audit.accepted, true);
  assert.match(result.context, /Retrieved at:/);
});

test('task intent detection stays narrow', () => {
  assert.equal(wantsWebResearch('收集最新资料并标注来源'), true);
  assert.equal(wantsWebResearch('写一封普通邮件'), false);
  assert.equal(wantsMarkdownArtifact('生成一个 report.md 文档'), true);
  assert.equal(wantsMarkdownArtifact('只回答问题'), false);
  assert.equal(wantsWorkspaceArtifact('收集资料并制作一个网页'), true);
  assert.equal(wantsWorkspaceArtifact('分析一下网页行业的数据'), false);
  assert.equal(wantsWorkspaceArtifact('只写一份普通报告'), false);
});

test('markdown artifacts stay inside the space output directory', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-runtime-'));
  try {
    const artifact = await writeMarkdownArtifact({
      projectRoot,
      userId: 'user-1',
      spaceId: 'space-1',
      runId: 'run-123456789',
      content: '# Report\n\nSafe output.',
    });
    assert.equal(artifact.fileName, '任务报告-run-1234.md');
    assert.equal(artifact.relativePath.startsWith('outputs/'), true);
    assert.equal(await readFile(artifact.absolutePath, 'utf8'), '# Report\n\nSafe output.');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('unsafe identifiers and oversized artifacts are rejected', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-runtime-'));
  try {
    await assert.rejects(
      writeMarkdownArtifact({ projectRoot, userId: '..', spaceId: 'space-1', runId: 'run-1', content: 'x' }),
      /格式不安全/
    );
    await assert.rejects(
      writeMarkdownArtifact({
        projectRoot,
        userId: 'user-1',
        spaceId: 'space-1',
        runId: 'run-1',
        content: 'x'.repeat(512 * 1024 + 1),
      }),
      /不能超过 512KB/
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('workspace tools write, read, patch and inspect webpage files', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-runtime-'));
  const options = { projectRoot, userId: 'user-1', spaceId: 'space-1' };
  try {
    await executeWorkspaceTool(options, 'write_file', {
      path: 'site/index.html',
      content: '<link rel="stylesheet" href="styles.css"><main>Hello</main>',
    });
    await executeWorkspaceTool(options, 'write_file', { path: 'site/styles.css', content: 'main { color: red; }' });
    await executeWorkspaceTool(options, 'patch_file', {
      path: 'site/index.html',
      search: 'Hello',
      replacement: 'Almaren',
    });

    const read = await executeWorkspaceTool(options, 'read_file', { path: 'site/index.html' });
    const check = await executeWorkspaceTool(options, 'check_files', {
      paths: ['site/index.html', 'site/styles.css'],
    });
    assert.match(read.content, /Almaren/);
    assert.equal(check.valid, true);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('workspace tools wait for async mutation audit callbacks', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-runtime-'));
  const calls = [];
  const options = {
    projectRoot,
    userId: 'user-1',
    spaceId: 'space-1',
    onMutation: async (relativePath) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      calls.push(`mutation:${relativePath}`);
    },
    onToolCall: async (name) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      calls.push(`tool:${name}`);
    },
  };
  try {
    await executeWorkspaceTool(options, 'write_file', { path: 'result.md', content: '# Result' });
    assert.deepEqual(calls, ['mutation:result.md', 'tool:write_file']);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('workspace tools reject traversal and report missing local webpage assets', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-runtime-'));
  const options = { projectRoot, userId: 'user-1', spaceId: 'space-1' };
  try {
    await assert.rejects(
      executeWorkspaceTool(options, 'write_file', { path: '../outside.txt', content: 'unsafe' }),
      /路径不安全/
    );
    await executeWorkspaceTool(options, 'write_file', {
      path: 'index.html',
      content: '<script src="missing.js"></script>',
    });
    const check = await executeWorkspaceTool(options, 'check_files', { paths: ['index.html'] });
    assert.equal(check.valid, false);
    assert.match(check.files[0].issues[0], /缺少本地引用/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('read_file paginates large files with bounded output', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-runtime-'));
  const options = { projectRoot, userId: 'user-1', spaceId: 'space-1' };
  try {
    await executeWorkspaceTool(options, 'write_file', { path: 'large.md', content: 'a'.repeat(20_000) });
    const first = await executeWorkspaceTool(options, 'read_file', { path: 'large.md' });
    const second = await executeWorkspaceTool(options, 'read_file', {
      path: 'large.md',
      offset: first.nextOffset,
      limit: 12_000,
    });
    assert.equal(first.content.length, 8_000);
    assert.equal(first.hasMore, true);
    assert.equal(second.content.length, 12_000);
    assert.equal(second.hasMore, false);
    assert.equal(second.totalChars, 20_000);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
