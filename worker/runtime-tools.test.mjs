import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assessResearchResult,
  assessResearchSources,
  diffWorkspaceSnapshots,
  executeWorkspaceTool,
  normalizeOfficialDomains,
  normalizeSearchQueries,
  researchRequirements,
  searchWeb,
  snapshotWorkspace,
  wantsMarkdownArtifact,
  wantsWebResearch,
  wantsWorkspaceArtifact,
  wantsWorkspaceWrite,
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
  assert.equal(requirements.timeRange, 'month');
  assert.equal(requirements.topic, 'general');
  assert.equal(researchRequirements('查找今天的财经新闻').topic, 'finance');
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
  const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
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
              publishedDate: recentDate,
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
            publishedDate: recentDate,
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
    requirements: { timeSensitive: true, primaryRequired: true, timeRange: 'year', topic: 'general' },
  });

  assert.equal(calls[0].options.timeRange, 'year');
  assert.deepEqual(calls[1].options.includeDomains, ['example.com']);
  assert.equal(calls[1].options.timeRange, 'year');
  assert.equal(calls[0].options.autoParameters, true);
  assert.equal(calls[2].urls[0], 'https://docs.example.com/pricing');
  assert.equal(result.sources[0].isPrimary, true);
  assert.equal(result.sources[0].sourceTier, 'A');
  assert.equal(result.sources[0].extractionStatus, 'extracted');
  assert.equal(result.audit.accepted, true);
  assert.match(result.context, /Retrieved at:/);
});

test('web research falls back to DuckDuckGo when Tavily is not configured', async () => {
  const calls = [];
  const recentTimestamp = Math.floor((Date.now() - 60 * 60 * 1000) / 1000);
  const ddgClient = {
    async search() {
      throw new Error('news queries should use DuckDuckGo News');
    },
    async searchNews(query, options) {
      calls.push({ query, options });
      return {
        results: [
          {
            title: 'Recent market news',
            url: 'https://news.example.com/recent',
            excerpt: 'Recent verified summary',
            date: recentTimestamp,
          },
        ],
      };
    },
  };

  const requirements = researchRequirements('查找今天的财经新闻');
  const result = await searchWeb(['今天的财经新闻'], null, { ddgClient, requirements });

  assert.equal(result.provider, 'duckduckgo');
  assert.equal(result.resultCount, 1);
  assert.equal(result.sources[0].extractionStatus, 'not_requested');
  assert.equal(result.audit.accepted, true);
  assert.equal(calls[0].options.time, 'd');
  assert.match(result.context, /搜索提供方：DuckDuckGo/);
});

test('task intent detection stays narrow', () => {
  assert.equal(wantsWebResearch('收集最新资料并标注来源'), true);
  assert.equal(wantsWebResearch('引用官方资料并提供证据链接'), true);
  assert.equal(wantsWebResearch('检查 HTML 本地资源引用与基础语法'), false);
  assert.equal(wantsWebResearch('制作鹈鹕骑车单文件 HTML 页面，不使用外部资源'), false);
  assert.equal(wantsWebResearch('制作一个无需联网资源、可以本地运行的互动网页'), false);
  assert.equal(wantsWebResearch('无需联网运行，但仍需搜索最新资料'), true);
  assert.equal(wantsWebResearch('写一封普通邮件'), false);
  assert.equal(wantsMarkdownArtifact('生成一个 report.md 文档'), true);
  assert.equal(wantsMarkdownArtifact('只回答问题'), false);
  assert.equal(wantsWorkspaceArtifact('收集资料并制作一个网页'), true);
  assert.equal(wantsWorkspaceArtifact('分析一下网页行业的数据'), false);
  assert.equal(wantsWorkspaceArtifact('只写一份普通报告'), false);
  assert.equal(wantsWorkspaceWrite('联网查询当前黄金价格并直接回答'), false);
  assert.equal(wantsWorkspaceWrite('本次只需要分析，不创建或修改文件'), false);
  assert.equal(wantsWorkspaceWrite('阅读报告，但不要修改任何文件'), false);
  assert.equal(wantsWorkspaceWrite('在空间里创建一份黄金分析报告'), true);
  assert.equal(wantsWorkspaceWrite('制作一个黄金对比网页'), true);
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

test('workspace snapshots report created, modified and deleted files', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-runtime-'));
  const options = { projectRoot, userId: 'user-1', spaceId: 'space-1' };
  try {
    await executeWorkspaceTool(options, 'write_file', { path: 'keep.md', content: 'before' });
    await executeWorkspaceTool(options, 'write_file', { path: 'remove.md', content: 'remove' });
    const before = await snapshotWorkspace(options);

    await executeWorkspaceTool(options, 'write_file', { path: 'keep.md', content: 'after' });
    await executeWorkspaceTool(options, 'write_file', { path: 'created.md', content: 'created' });
    await rm(path.join(projectRoot, 'data', 'spaces', 'user-1', 'space-1', 'workspace', 'remove.md'));

    const entries = diffWorkspaceSnapshots(before, await snapshotWorkspace(options));
    assert.deepEqual(entries.map(({ path: filePath, change }) => ({ path: filePath, change })), [
      { path: 'created.md', change: 'CREATED' },
      { path: 'keep.md', change: 'MODIFIED' },
      { path: 'remove.md', change: 'DELETED' },
    ]);
    assert.deepEqual(diffWorkspaceSnapshots(before, {
      ...before,
      files: before.files.map((file) => ({ ...file, mtimeMs: file.mtimeMs + 1 })),
    }), []);
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
