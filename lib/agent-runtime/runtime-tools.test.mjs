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
  researchSourceIsRelevant,
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
  assert.equal(requirements.authorityRequired, true);
  assert.equal(requirements.timeRange, 'month');
  assert.equal(requirements.topic, 'general');
  assert.equal(researchRequirements('查找今天的财经新闻').topic, 'finance');
  assert.equal(researchRequirements('查找今天的公告').timeRange, 'day');
  assert.equal(researchRequirements('整理本周动态').timeRange, 'week');
  assert.equal(researchRequirements('汇总本月新闻').timeRange, 'month');
  assert.equal(researchRequirements('研究历史背景').timeRange, null);
  assert.equal(audit.accepted, false);
  assert.match(audit.issues.join('\n'), /权威来源/);
  assert.match(audit.issues.join('\n'), /第一方来源/);
  assert.match(audit.issues.join('\n'), /发布日期/);
});

test('research source audit rejects unrelated fresh authority pages', () => {
  const requirements = {
    ...researchRequirements('郑州国家森林公园最新官方交通'),
    relevanceQueries: ['郑州国家森林公园 森林公园北站'],
  };
  const recentDate = new Date().toISOString();
  const unrelatedAuthority = {
    title: '河南省建设工程招标公告',
    url: 'https://example.gov.cn/tender/1',
    summary: '信阳市业务用房工程监理项目',
    sourceTier: 'A',
    isPrimary: false,
    publishedDate: recentDate,
    extractionStatus: 'extracted',
    extractedContent: '工程招标与候选人名单',
  };
  const audit = assessResearchSources([unrelatedAuthority], requirements);
  assert.equal(researchSourceIsRelevant(unrelatedAuthority, requirements), false);
  assert.equal(audit.relevantCount, 0);
  assert.equal(audit.accepted, false);
  assert.match(audit.issues.join('\n'), /不相关/);
  assert.match(audit.issues.join('\n'), /第一方/);
});

test('research relevance tolerates a shortened Chinese entity name', () => {
  assert.equal(researchSourceIsRelevant({
    title: '郑州森林公园游览信息',
    summary: '园区交通与开放安排',
    url: 'https://example.com/park',
  }, {
    relevanceQueries: ['郑州国家森林公园 最新交通'],
  }), true);
});

test('research relevance splits mixed-script entity names without accepting generic topic words', () => {
  const requirements = {
    relevanceQueries: ['FX战士久留美 角色 剧情', 'FX戦士くるみちゃん 登場人物 故事'],
  };
  assert.equal(researchSourceIsRelevant({
    title: 'FX戦士くるみちゃん 作品紹介',
    summary: '登場人物と物語の紹介',
    url: 'https://example.jp/kurumi',
  }, requirements), true);
  assert.equal(researchSourceIsRelevant({
    title: '本周热门角色剧情盘点',
    summary: '十部作品的故事介绍',
    url: 'https://example.com/unrelated',
  }, requirements), false);
});

test('explicit primary-source requirements cannot be satisfied by authority tier alone', () => {
  const audit = assessResearchSources([{
    title: '目标实体相关的政府报道',
    url: 'https://news.gov.cn/target',
    summary: '目标实体最新情况',
    sourceTier: 'A',
    isPrimary: false,
    publishedDate: new Date().toISOString(),
    extractionStatus: 'extracted',
  }], {
    timeSensitive: true,
    primaryRequired: true,
    timeRange: 'month',
    relevanceQueries: ['目标实体'],
  });
  assert.equal(audit.authorityCount, 1);
  assert.equal(audit.primaryCount, 0);
  assert.equal(audit.accepted, false);
  assert.match(audit.issues.join('\n'), /第一方/);
});

test('live weather pages accept extracted observation time as freshness evidence', () => {
  const requirements = researchRequirements('查询郑州当前实时天气');
  const audit = assessResearchSources([{
    sourceTier: 'A',
    isPrimary: true,
    publishedDate: null,
    retrievedAt: new Date().toISOString(),
    summary: '郑州天气',
    extractedContent: '郑州 08:55实况 多云 26℃ 湿度62%',
    extractionStatus: 'extracted',
  }], requirements);

  assert.equal(requirements.liveData, true);
  assert.equal(audit.datedCount, 0);
  assert.equal(audit.liveEvidenceCount, 1);
  assert.equal(audit.freshDatedCount, 1);
  assert.equal(audit.accepted, true);
});

test('article freshness still requires a dated source', () => {
  const requirements = researchRequirements('查询最新版本公告');
  const audit = assessResearchSources([{
    sourceTier: 'A',
    isPrimary: true,
    publishedDate: null,
    retrievedAt: new Date().toISOString(),
    summary: '08:55 更新于页面',
    extractedContent: '版本说明',
    extractionStatus: 'extracted',
  }], requirements);

  assert.equal(requirements.liveData, false);
  assert.equal(audit.accepted, false);
});

test('live evidence does not trust a search summary when body extraction failed', () => {
  const requirements = researchRequirements('查询郑州当前实时天气');
  const audit = assessResearchSources([{
    sourceTier: 'A',
    isPrimary: true,
    publishedDate: null,
    retrievedAt: new Date().toISOString(),
    summary: '郑州 08:55实况 多云',
    extractedContent: '',
    extractionStatus: 'failed',
  }], requirements);

  assert.equal(audit.liveEvidenceCount, 0);
  assert.equal(audit.accepted, false);
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

test('web research asks one semantic reviewer when deterministic matching rejects every candidate', async () => {
  const reviewCalls = [];
  const client = {
    async search() {
      return { results: [{
        title: 'くるみちゃんと外国為替の物語',
        url: 'https://example.jp/story',
        content: '少女たちがFX取引に挑む漫画作品',
      }] };
    },
    async extract(urls) {
      return { results: urls.map((url) => ({ url, rawContent: '作品本文' })), failedResults: [] };
    },
  };
  const result = await searchWeb(['FX战士久留美 人物资料'], 'test-key', {
    client,
    reviewRelevance: async (payload) => {
      reviewCalls.push(payload);
      return [payload.sources[0].url];
    },
  });

  assert.equal(reviewCalls.length, 1);
  assert.equal(reviewCalls[0].sources[0].extractedContent, undefined);
  assert.equal(result.resultCount, 1);
  assert.equal(result.audit.semanticReviewUsed, true);
  assert.match(result.context, /example\.jp\/story/);
});

test('configured Tavily falls back to DuckDuckGo after both program and semantic review reject its candidates', async () => {
  let semanticReviewCount = 0;
  let ddgCount = 0;
  const client = {
    async search() {
      return { results: [{ title: '外汇市场日报', url: 'https://finance.example.com/daily', content: '美元行情' }] };
    },
    async extract() {
      return { results: [], failedResults: [] };
    },
  };
  const ddgClient = {
    async search() {
      ddgCount += 1;
      return { results: [{
        title: 'FX战士久留美作品与人物介绍',
        url: 'https://anime.example.net/kurumi',
        description: '福路久留美与外汇交易故事',
      }] };
    },
    async searchNews() {
      throw new Error('not a news query');
    },
  };
  const result = await searchWeb(['FX战士久留美 人物资料'], 'test-key', {
    client,
    ddgClient,
    reviewRelevance: async () => {
      semanticReviewCount += 1;
      return [];
    },
  });

  assert.equal(semanticReviewCount, 1);
  assert.equal(ddgCount, 1);
  assert.equal(result.provider, 'duckduckgo');
  assert.equal(result.fallbackFrom, 'tavily');
  assert.equal(result.resultCount, 1);
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

test('patch_files validates every edit before writing any file', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-runtime-'));
  const mutations = [];
  const options = {
    projectRoot,
    userId: 'user-1',
    spaceId: 'space-1',
    onMutation: (relativePath) => mutations.push(relativePath),
  };
  try {
    await executeWorkspaceTool(options, 'write_file', { path: 'a.md', content: 'alpha' });
    await executeWorkspaceTool(options, 'write_file', { path: 'b.md', content: 'beta' });
    mutations.length = 0;

    await assert.rejects(executeWorkspaceTool(options, 'patch_files', {
      edits: [
        { path: 'a.md', search: 'alpha', replacement: 'changed' },
        { path: 'b.md', search: 'missing', replacement: 'changed' },
      ],
    }), /找不到待替换内容/);
    assert.equal((await executeWorkspaceTool(options, 'read_file', { path: 'a.md' })).content, 'alpha');
    assert.deepEqual(mutations, []);

    const result = await executeWorkspaceTool(options, 'patch_files', {
      edits: [
        { path: 'a.md', search: 'alpha', replacement: 'first' },
        { path: 'a.md', search: 'first', replacement: 'done' },
        { path: 'b.md', search: 'beta', replacement: 'done' },
      ],
    });
    assert.deepEqual(result.paths, ['a.md', 'b.md']);
    assert.deepEqual(mutations, ['a.md', 'b.md']);
    assert.equal((await executeWorkspaceTool(options, 'read_file', { path: 'a.md' })).content, 'done');
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

test('read_file reads normal workspace files once and paginates only oversized files', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-runtime-'));
  const options = { projectRoot, userId: 'user-1', spaceId: 'space-1' };
  try {
    await executeWorkspaceTool(options, 'write_file', { path: 'normal.md', content: 'a'.repeat(99_589) });
    const normal = await executeWorkspaceTool(options, 'read_file', {
      path: 'normal.md',
      limit: 12_000,
    });
    assert.equal(normal.content.length, 99_589);
    assert.equal(normal.hasMore, false);

    await executeWorkspaceTool(options, 'write_file', { path: 'large.md', content: 'a'.repeat(150_000) });
    const first = await executeWorkspaceTool(options, 'read_file', { path: 'large.md' });
    const second = await executeWorkspaceTool(options, 'read_file', {
      path: 'large.md',
      offset: first.nextOffset,
      limit: 128_000,
    });
    assert.equal(first.content.length, 128_000);
    assert.equal(first.hasMore, true);
    assert.equal(second.content.length, 22_000);
    assert.equal(second.hasMore, false);
    assert.equal(second.totalChars, 150_000);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
