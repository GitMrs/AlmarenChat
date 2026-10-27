import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';

// content-provider.ts 依赖的真实视频/ASR 模块（纯 JS，可直接加载；单测不触发真实抓取/转写）
const webVideoModule = await import('../video/web-video.mjs');
const videoAsrModule = await import('../video/video-asr.mjs');

async function loadTsModule(relativePath, mockModules = {}) {
  const filePath = path.resolve(process.cwd(), relativePath);
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
      if (name in mockModules) return mockModules[name];
      if (name === 'node:fs/promises' || name === 'fs/promises') return fsPromises;
      if (name === 'node:path' || name === 'path') return path;
      if (name === './types') return {};
      if (name === '@/lib/video/web-video.mjs') return webVideoModule;
      if (name === '@/lib/video/video-asr.mjs') return videoAsrModule;
      if (name.includes('bilibili-search')) {
        return {
          searchBilibiliVideos: async () => [],
        };
      }
      if (name.startsWith('./')) {
        // 同级内部文件
        const subPath = path.resolve(path.dirname(filePath), name + '.ts');
        const subSource = ts.transpileModule(
          ts.sys.readFile(subPath) || '',
          { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }
        ).outputText;
        const subExports = {};
        vm.runInNewContext(subSource, {
          exports: subExports,
          module: { exports: subExports },
          console,
          process,
          require: context.require,
        });
        return subExports;
      }
      throw new Error(`Unexpected import in test: ${name}`);
    },
  };

  vm.runInNewContext(output, context);
  return exports;
}

test('resolveAgentInterestProfile resolves tailored profiles for companions and categories', async () => {
  const matcher = await loadTsModule('lib/agent-study/interest-matcher.ts');
  const sunnyProfile = matcher.resolveAgentInterestProfile({ id: 'companion-nari', name: 'Sunny' });
  assert.ok(sunnyProfile.keywords.includes('心理'));
  assert.ok(sunnyProfile.keywords.includes('治愈'));
  assert.ok(sunnyProfile.preferredSources.includes('bilibili'));

  const lafeiProfile = matcher.resolveAgentInterestProfile({ id: 'companion-lafei', name: '拉菲' });
  assert.ok(lafeiProfile.keywords.includes('红酒'));
  assert.ok(lafeiProfile.keywords.includes('动漫'));

  const techProfile = matcher.resolveAgentInterestProfile({
    name: '全栈架构师',
    category: '技术',
    description: '负责分布式架构与代码优化',
  });
  assert.ok(techProfile.keywords.includes('架构'));
  assert.ok(techProfile.preferredSources.includes('hellogithub'));
});

test('matchAgentStudyCandidates matches top 3 candidates from real trending pool', async () => {
  const matcher = await loadTsModule('lib/agent-study/interest-matcher.ts');
  const candidates = await matcher.matchAgentStudyCandidates({
    id: 'companion-nari',
    name: 'Sunny',
    category: '心理',
    description: '生活在温暖花房中的少女',
  }, { limit: 3 });

  assert.equal(candidates.length, 3);
  for (const item of candidates) {
    assert.ok(item.id, 'item must have id');
    assert.ok(item.title, 'item must have title');
    assert.ok(item.url, 'item must have url');
    assert.ok(item.source, 'item must have source');
    assert.ok(item.sourceName, 'item must have sourceName');
  }
});

test('distillDailyStudy uses fallback when LLM is offline and produces valid output', async () => {
  const engine = await loadTsModule('lib/agent-study/study-engine.ts', {
    '@/lib/core/model-client': {
      createModelClient() {
        return {
          chat: {
            completions: {
              async create() {
                throw new Error('Offline in test');
              },
            },
          },
        };
      },
      resolveModelName() { return 'test-model'; },
    },
  });

  const candidates = [
    {
      id: 'test-1',
      source: 'bilibili',
      sourceName: 'B站',
      title: '如何做出松软的舒芙蕾松饼',
      url: 'https://www.bilibili.com/video/BV1rfnF6sEme/?vd_source=8a08217166bdee0ab4dcdfe14204055eS',
      desc: '详细讲解蛋白打发和低温慢煎技巧',
      heat: '50万播放',
      matchScore: 10,
    },
    {
      id: 'test-2',
      source: 'youtube',
      sourceName: 'youtube',
      title: 'youtube',
      url: 'https://www.youtube.com/watch?v=8oX5TYLELuc&list=PLCMyiYW9m9m-izfioFdS9ouQ9fhcvzMEY',
      desc: 'youtube',
      heat: 'youtube',
      matchScore: 10,
    }
  ];

  const result = await engine.distillDailyStudy(
    { name: 'Sunny', tone: '温柔' },
    candidates
  );

  assert.ok(result.greeting.length > 10, 'greeting must be meaningful');
  assert.equal(result.items.length, 2);
  assert.ok(result.items[0].summary.length > 5);
  assert.ok(result.items[0].thoughts.length > 5);
});

test('loadDailyStudyRecord and saveDailyStudyRecord persist and retrieve daily record', async () => {
  const storage = await loadTsModule('lib/agent-study/storage.ts', {
    '@/app/api/_lib/db': { default: {} },
  });

  const testAgentId = 'unit-test-agent-' + Date.now();
  const testDate = '2026-10-20';
  const initialRecord = {
    agentId: testAgentId,
    agentName: '拉菲测试号',
    date: testDate,
    greeting: '测试问候语',
    items: [
      {
        id: 'c1',
        source: 'bilibili',
        sourceName: 'B站',
        title: '测试视频',
        url: 'https://bilibili.com',
        summary: '干货要点',
        thoughts: '角色心得',
        learnedAt: new Date().toISOString(),
      },
    ],
    sharedWithUser: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await storage.saveDailyStudyRecord(initialRecord);

  const loaded = await storage.loadDailyStudyRecord(testAgentId, testDate);
  assert.ok(loaded);
  assert.equal(loaded.agentId, testAgentId);
  assert.equal(loaded.items.length, 1);
  assert.equal(loaded.items[0].title, '测试视频');

  // 清理测试文件
  const testFilePath = path.join(process.cwd(), 'data', 'agent-study', testDate, `${testAgentId}.json`);
  await rm(testFilePath, { force: true });
});

test('service.getOrGenerateDailyStudy coordinates matching, fallback, and markDailyStudyShared', async () => {
  const service = await loadTsModule('lib/agent-study/service.ts', {
    '@/app/api/_lib/spaces': {
      async resolveAgent(agentId) {
        return {
          id: agentId,
          name: '拉菲',
          category: '二次元',
          tone: '温柔',
          description: '白发可爱的舰灵伴侣，慵懒微醺',
        };
      },
    },
    '@/lib/core/model-client': {
      createModelClient() {
        return {
          chat: {
            completions: {
              async create() {
                throw new Error('Offline in test');
              },
            },
          },
        };
      },
      resolveModelName() { return 'test-model'; },
    },
    '@/app/api/_lib/db': {
      default: {
        agentExperience: {
          async findUnique() { return null; },
          async upsert() { return {}; },
        },
      },
    },
    './ingest': {
      scheduleStudyKnowledgeIngestion() {},
    },
  });

  const testAgentId = 'companion-lafei-test-' + Date.now();
  const testDate = '2026-10-20';

  // 1. 生成今日学习（命中真实候选，Fallback 双轨提炼）
  const record = await service.getOrGenerateDailyStudy(testAgentId, 'user-1', {
    date: testDate,
    forceRefresh: true,
  });

  assert.ok(record);
  assert.equal(record.agentId, testAgentId);
  assert.equal(record.agentName, '拉菲');
  assert.equal(record.items.length, 3);
  assert.equal(record.sharedWithUser, false);
  assert.ok(record.greeting.length > 5);

  // 2. 标记已分享
  const shared = await service.markDailyStudyShared(testAgentId, testDate);
  assert.ok(shared);
  assert.equal(shared.sharedWithUser, true);

  // 3. 再次获取（命中日内缓存，保持稳定）
  const cached = await service.getOrGenerateDailyStudy(testAgentId, 'user-1', {
    date: testDate,
  });
  assert.equal(cached.sharedWithUser, true);
  assert.equal(cached.items[0].id, record.items[0].id);

  // 清理
  const testFilePath = path.join(process.cwd(), 'data', 'agent-study', testDate, `${testAgentId}.json`);
  await rm(testFilePath, { force: true });
});

test('isAgentStudyEnabled defaults only to Sunny, and setAgentStudyEnabled persists toggle', async () => {
  const mockDbRecords = new Map();
  const mockFiles = new Map();
  const mockPrisma = {
    agentModelSetting: {
      async findUnique({ where }) {
        const key = `${where.userId_agentId.userId}:${where.userId_agentId.agentId}`;
        return mockDbRecords.get(key) || null;
      },
      async upsert({ where, create, update }) {
        const key = `${where.userId_agentId.userId}:${where.userId_agentId.agentId}`;
        const existing = mockDbRecords.get(key) || {};
        const merged = { ...existing, ...(mockDbRecords.has(key) ? update : create) };
        mockDbRecords.set(key, merged);
        return merged;
      },
    },
  };

  const storage = await loadTsModule('lib/agent-study/storage.ts', {
    '@/app/api/_lib/db': { default: mockPrisma },
    'node:fs/promises': {
      async mkdir() {},
      async readFile(file) { return mockFiles.get(file) || '{}'; },
      async writeFile(file, content) { mockFiles.set(file, content); },
      async rename(from, to) { mockFiles.set(to, mockFiles.get(from)); mockFiles.delete(from); },
    },
  });
  const { isAgentStudyEnabled, getAgentStudySettings, setAgentStudyEnabled } = storage;

  // 1. 默认情况下，Sunny 开启，拉菲与柯拉关闭
  assert.equal(await isAgentStudyEnabled('companion-nari'), true);
  assert.equal(await isAgentStudyEnabled('nari'), true);
  assert.equal(await isAgentStudyEnabled('companion-lafei'), false);
  assert.equal(await isAgentStudyEnabled('companion-yume'), false);
  assert.equal(await isAgentStudyEnabled('custom-agent-123'), false);

  // 2. 为拉菲在数据库中开启 (基于 AgentModelSetting 表持久化)
  await setAgentStudyEnabled('companion-lafei', true, 'user-mock-1');
  assert.equal(await isAgentStudyEnabled('companion-lafei', 'user-mock-1'), true);
  // 其他没有设置的用户依然默认关闭
  assert.equal(await isAgentStudyEnabled('companion-lafei', 'user-other'), false);

  // 3. 再次为拉菲关闭并验证数据库持久化状态
  await setAgentStudyEnabled('companion-lafei', false, 'user-mock-1');
  assert.equal(await isAgentStudyEnabled('companion-lafei', 'user-mock-1'), false);

  // 4. 快照缓存模式也同样工作
  const snapshotSettings = await getAgentStudySettings();
  assert.equal(await isAgentStudyEnabled('companion-nari', snapshotSettings), true);
});

test('content kind routing separates knowledge from news, videos need subtitles to be ingested', async () => {
  const kinds = await loadTsModule('lib/agent-study/content-kind.ts');

  // 1. 只有能产出正文（文章/仓库/字幕视频）的来源才可能沉淀
  assert.equal(kinds.isKnowledgeEligibleSource('zhihu'), true);
  assert.equal(kinds.isKnowledgeEligibleSource('hellogithub'), true);
  assert.equal(kinds.isKnowledgeEligibleSource('bilibili'), true);
  assert.equal(kinds.isKnowledgeEligibleSource('youtube'), true);
  assert.equal(kinds.isKnowledgeEligibleSource('acfun'), false);

  // 2. 视频有字幕正文且分型为 knowledge 时可以入库
  const longContent = '知识正文'.repeat(300);
  assert.equal(
    kinds.shouldIngestAsKnowledge({
      source: 'bilibili',
      content: longContent,
      assessment: { contentKind: 'knowledge' },
    }),
    true
  );

  // 3. 资讯/观点不进知识库
  assert.equal(
    kinds.shouldIngestAsKnowledge({
      source: 'zhihu',
      content: longContent,
      assessment: { contentKind: 'news' },
    }),
    false
  );

  // 4. 正文不足也不入库
  assert.equal(
    kinds.shouldIngestAsKnowledge({
      source: 'zhihu',
      content: '太短',
      assessment: { contentKind: 'knowledge' },
    }),
    false
  );

  // 5. 符合条件才沉淀
  assert.equal(
    kinds.shouldIngestAsKnowledge({
      source: 'zhihu',
      content: longContent,
      assessment: { contentKind: 'knowledge' },
    }),
    true
  );

  // 6. 未知类型降级为 news
  assert.equal(kinds.normalizeContentKind('unknown-kind'), 'news');
});

test('buildStudyKnowledgeMarkdown keeps provenance and key points for chunking', async () => {
  const kinds = await loadTsModule('lib/agent-study/content-kind.ts');
  const markdown = kinds.buildStudyKnowledgeMarkdown({
    item: {
      title: '如何理解向量检索',
      sourceName: '知乎',
      url: 'https://example.com/a',
    },
    assessment: {
      title: '向量检索的核心原理',
      summary: '向量检索通过余弦相似度比较语义向量。',
      keyPoints: ['先做归一化', '再计算余弦相似度'],
      category: '技术',
    },
    date: '2026-10-21',
    content: '## 正文\n这里是抓取到的完整正文。',
  });

  assert.match(markdown, /^# 向量检索的核心原理/);
  assert.match(markdown, /来源：知乎 \| https:\/\/example\.com\/a \| 研习日期：2026-10-21/);
  assert.match(markdown, /## 摘要/);
  assert.match(markdown, /- 先做归一化/);
  assert.match(markdown, /## 原文/);
});

test('ingestStudyKnowledge keeps synthesized methods in knowledge without creating personal memories', async () => {
  const indexed = [];
  const createdMemories = [];
  const contentMap = {
    'zhihu-knowledge': '知识正文'.repeat(400),
    'zhihu-fact': '知识正文'.repeat(400),
  };

  const ingest = await loadTsModule('lib/agent-study/ingest.ts', {
    '@/app/api/_lib/db': {
      default: {
        agentMemoryItem: {
          async findMany() { return []; },
          async create({ data }) {
            createdMemories.push(data);
            return data;
          },
        },
      },
    },
    '@/lib/knowledge/knowledge': {
      async indexKnowledgeText(target, input) {
        indexed.push({ target, input });
        return { document: { id: `doc-${indexed.length}` }, chunkCount: 1, skipped: false };
      },
    },
    '@/lib/agents/growth/agent-growth': { async appendAgentGrowthEvent() { assert.fail('ordinary content has no growth'); } },
    '@/lib/personal-assistant/memory-dedup.mjs': {
      isDuplicateMemory() { return false; },
    },
    './content-provider': {
      async fetchStudyContent(item) {
        return contentMap[item.id]
          ? { id: item.id, source: item.source, url: item.url, title: item.title, text: contentMap[item.id], fetched: true }
          : { id: item.id, source: item.source, url: item.url, title: item.title, text: '', fetched: false, reason: 'source_not_eligible' };
      },
    },
    './knowledge-assessor': {
      async synthesizeKnowledgeDocument() { return '## 方法论与实操步骤\n1. 先归一化各个向量，使长度可比较；2. 计算余弦相似度；3. 用已标注的样本检查阈值，边界样本需要人工复核。'; },
      async assessStudyContents({ items }) {
        const map = new Map();
        for (const { item } of items) {
          map.set(item.id, item.id === 'zhihu-fact'
            ? { id: item.id, contentKind: 'personal_fact', summary: '用户喜欢用向量检索做知识管理。', keyPoints: [], confidence: 0.9 }
            : { id: item.id, contentKind: 'knowledge', title: '向量检索原理', summary: '向量检索依赖余弦相似度。', keyPoints: ['归一化'], confidence: 0.82 });
        }
        for (const item of items.map((entry) => entry.item)) {
          if (!map.has(item.id)) map.set(item.id, { id: item.id, contentKind: 'news', summary: item.summary, keyPoints: [], confidence: 0 });
        }
        return map;
      },
    },
    './storage': {
      async loadDailyStudyRecord() { return null; },
      async saveDailyStudyRecord() {},
    },
  });

  const makeItem = (id, source, sourceName) => ({
    id,
    source,
    sourceName,
    title: `标题-${id}`,
    url: `https://example.com/${id}`,
    summary: `摘要-${id}`,
    thoughts: `心得-${id}`,
    learnedAt: '2026-10-21T00:00:00.000Z',
  });

  const result = await ingest.ingestStudyKnowledge({
    agentId: 'companion-nari',
    userId: 'user-1',
    agentName: 'Sunny',
    date: '2026-10-21',
    greeting: '你好',
    items: [
      makeItem('zhihu-knowledge', 'zhihu', '知乎'),
      makeItem('zhihu-fact', 'zhihu', '知乎'),
      makeItem('bilibili-video', 'bilibili', 'B站'),
    ],
    sharedWithUser: false,
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:00.000Z',
  });

  // 只有知识条目进入知识库，视频只留作经历
  assert.equal(indexed.length, 1);
  assert.equal(indexed[0].target.agentId, 'companion-nari');
  assert.equal(indexed[0].target.userId, 'user-1');
  assert.equal(indexed[0].input.sourceType, 'STUDY');
  assert.equal(indexed[0].input.sourceKey, 'zhihu-knowledge');
  assert.equal(indexed[0].input.status, 'ACTIVE');
  assert.match(indexed[0].input.content, /方法论与实操步骤/);
  assert.equal(result.knowledgeIds['zhihu-knowledge'], 'doc-1');
  assert.equal(result.knowledgeIds['bilibili-video'], undefined);

  // 即使评估器错误返回 personal_fact，外部文章也不能写成当前用户的个人记忆。
  assert.equal(createdMemories.length, 0);
  assert.equal(result.memoryCount, 0);
  assert.ok(result.skipped.some((entry) => entry.startsWith('bilibili-video')));
});

test('ordinary study retains experience without automatically appending growth', async () => {
  const experiences = [];
  const growth = [];
  const storage = await loadTsModule('lib/agent-study/storage.ts', {
    '@/app/api/_lib/db': { default: {
      agentExperience: { async findUnique() { return null; }, async upsert(input) { experiences.push(input.create); } },
      agentGrowthEvent: { async upsert(input) { growth.push(input.create); } },
    } },
  });
  await storage.syncStudyToAgentExperience('user-1', {
    agentId: 'agent-1', date: '2026-10-27',
    items: [{ id: 'article-1', title: '新闻', thoughts: '今天看到了这条新闻', summary: '新闻摘要', sourceName: '平台', url: 'https://example.com' }],
  });
  assert.equal(experiences.length, 1);
  assert.equal(experiences[0].sourceType, 'STUDY');
  assert.equal(growth.length, 0);
});

test('repeated study synchronization preserves corrected summaries and forgotten status', async () => {
  const existing = { summary: '用户纠正后的学习心得', edited: true, status: 'DELETED' };
  const storage = await loadTsModule('lib/agent-study/storage.ts', {
    '@/app/api/_lib/db': { default: { agentExperience: {
      async findUnique() { return existing; },
      async upsert({ update }) { Object.assign(existing, update); },
    } } },
  });
  await storage.syncStudyToAgentExperience('user-1', {
    agentId: 'agent-1', date: '2026-10-27',
    items: [{ id: 'article-1', title: '资料', thoughts: '原始心得', summary: '原始摘要', sourceName: '平台', url: 'https://example.com' }],
  });
  assert.equal(existing.summary, '用户纠正后的学习心得');
  assert.equal(existing.status, 'DELETED');
});

test('growth recall excludes legacy reading feeds and automatic task reviews', async () => {
  const growth = await loadTsModule('lib/agents/growth/agent-growth.ts', {
    '@/app/api/_lib/db': { default: {} },
    'node:crypto': { randomUUID() { return 'id'; } },
  });
  const events = [
    { type: 'STUDY', sourceType: 'STUDY', payload: { title: '旧版阅读流水' }, createdAt: '2026-10-27' },
    { type: 'REFLECTION', sourceType: 'TASK', payload: { title: '任务验收记录', outcome: 'ACCEPTED', taskId: 'task-1' }, createdAt: '2026-10-27' },
    { type: 'REVISION', sourceType: 'STUDY', payload: { title: '修正沟通方法', content: '先理解情绪再给出建议' }, createdAt: '2026-10-27' },
  ];
  const context = growth.formatAgentGrowthContext(events, '');
  assert.match(context, /先理解情绪/);
  assert.doesNotMatch(context, /旧版阅读流水|任务验收记录|当前成长阶段/);
  assert.equal(growth.formatAgentGrowthContext(events, '无关问题'), '');
});

test('study assessment rejects invented evidence, weak growth and unsupported revisions', async () => {
  const evidence = '应先理解对方情绪再提出建议，具体干预要结合实际情境。';
  const candidate = { type: 'BELIEF', title: '先理解情绪', content: '面对倾诉时先确认情绪，再讨论方法。', evidence, confidence: 0.9 };
  const raw = [
    { ...candidate },
    { ...candidate, confidence: 0.6 },
    { ...candidate, evidence: '这是完全没有出现在原文里的另一段证据。' },
    { ...candidate, type: 'REVISION', previousEventId: 'invented' },
    { ...candidate, type: 'REVISION', previousEventId: 'belief-1' },
  ];
  const assessor = await loadTsModule('lib/agent-study/knowledge-assessor.ts', {
    '@/lib/core/model-client': {
      createModelClient() { return { chat: { completions: { async create() {
        return { choices: [{ message: { content: JSON.stringify({ items: raw.map((growth, index) => ({
          id: String(index), contentKind: 'personal_fact', summary: '作者喜欢某种方法', confidence: 0.9, growth,
        })) }) } }] };
      } } } }; },
      resolveModelName() { return 'test-model'; },
    },
  });
  const assessments = await assessor.assessStudyContents({
    agent: { name: 'Sunny' },
    previousBeliefs: [{ id: 'belief-1', content: '先给建议再安抚情绪' }],
    items: raw.map((_, index) => ({ item: { id: String(index), title: '情绪支持', sourceName: 'B站', source: 'bilibili' }, content: evidence })),
  });
  assert.equal(assessments.get('0').growth.type, 'BELIEF');
  assert.equal(assessments.get('0').contentKind, 'opinion');
  for (const id of ['1', '2', '3']) assert.equal(assessments.get(id).growth, undefined);
  assert.equal(assessments.get('4').growth.previousEventId, 'belief-1');
});

test('study ingestion records validated growth independently of knowledge and deduplicates retries', async () => {
  const events = new Map();
  const evidence = '应先理解对方情绪再提出建议，具体干预要结合实际情境。';
  const ingest = await loadTsModule('lib/agent-study/ingest.ts', {
    '@/app/api/_lib/db': { default: {
      agentGrowthEvent: {
        async findMany() { return []; },
      },
    } },
    '@/lib/agents/growth/agent-growth': { async appendAgentGrowthEvent(input) {
      if (!events.has(input.eventKey)) events.set(input.eventKey, input);
    } },
    '@/lib/knowledge/knowledge': { async indexKnowledgeText() { assert.fail('opinion must not enter knowledge'); } },
    '@/lib/personal-assistant/memory-dedup.mjs': { isDuplicateMemory() { return false; } },
    './content-provider': { async fetchStudyContent(item) { return { ...item, fetched: true, text: evidence }; } },
    './knowledge-assessor': { async assessStudyContents() { return new Map([
      ['valid', { contentKind: 'opinion', growth: { type: 'REFLECTION', title: '调整回应方法', content: '以后倾听时先确认情绪，方法建议要结合具体处境。', evidence, confidence: 0.9 } }],
      ['plain', { contentKind: 'news' }],
      ['invalid', { contentKind: 'opinion', growth: { type: 'BELIEF', title: '错误证据', content: '不应记录', evidence: '原文中没有这句话也没有此种说法。', confidence: 0.99 } }],
    ]); } },
    './storage': { async loadDailyStudyRecord() { return null; }, async saveDailyStudyRecord() {} },
  });
  const record = { userId: 'user-1', agentId: 'agent-1', agentName: 'Sunny', date: '2026-10-27',
    items: ['valid', 'plain', 'invalid'].map(id => ({ id, source: 'bilibili', sourceName: 'B站', url: `https://example.com/${id}` })),
  };
  await ingest.ingestStudyKnowledge(record);
  await ingest.ingestStudyKnowledge(record);
  assert.equal(events.size, 1);
  const event = [...events.values()][0];
  assert.equal(event.type, 'REFLECTION');
  assert.equal(event.payload.evidence, evidence);
  assert.equal(event.sourceType, 'STUDY');
  assert.equal(event.userId, 'user-1');
});

test('extractGitHubRepo resolves github urls and HelloGitHub titles', async () => {
  const provider = await loadTsModule('lib/agent-study/content-provider.ts', {
    '@/lib/web/fetch-webpage': { async fetchWebpageContent() { return { content: '' }; } },
  });

  const gh = provider.extractGitHubRepo({
    source: 'github',
    url: 'https://github.com/baidu-baige/LoongForge',
    title: 'LoongForge',
  });
  assert.equal(gh.owner, 'baidu-baige');
  assert.equal(gh.repo, 'LoongForge');

  const hello = provider.extractGitHubRepo({
    source: 'hellogithub',
    url: 'https://hellogithub.com/repository/2eafb075947e41a4be4d157a6f0382ae',
    title: '1lck/Lithe-IDEA: 轻量级的 Java IDE 编程工具',
  });
  assert.equal(hello.owner, '1lck');
  assert.equal(hello.repo, 'Lithe-IDEA');
  assert.equal(
    provider.extractGitHubRepo({ source: 'zhihu', url: 'https://www.zhihu.com/question/1', title: '问题' }),
    null
  );
});

test('knowledge quota keeps at least one fetchable-source candidate', async () => {
  const matcher = await loadTsModule('lib/agent-study/interest-matcher.ts');
  const selected = await matcher.matchAgentStudyCandidates(
    { id: 'companion-nari', name: 'Sunny', category: 'companion' },
    { limit: 3, knowledgeQuota: 1 }
  );

  assert.equal(selected.length, 3);
  const fetchable = new Set(['juejin', 'sspai', 'csdn', 'github', 'hellogithub']);
  assert.ok(
    selected.some((item) => fetchable.has(item.source)),
    `expected a fetchable source, got ${selected.map((item) => item.source).join(',')}`
  );
});

async function loadSchedulerModule() {
  return loadTsModule('lib/agent-study/scheduler.ts', {
    '@/app/api/_lib/db': { default: {} },
    '@/app/api/_lib/agent-model': {
      resolveUserModelConfig() { return {}; },
    },
    './service': { async getOrGenerateDailyStudy() { return {}; } },
    './storage': {
      getLocalISODate(date = new Date()) {
        const offset = date.getTimezoneOffset() * 60000;
        return new Date(date.getTime() - offset).toISOString().split('T')[0];
      },
      async loadDailyStudyRecord() { return null; },
    },
    '../core/scheduler.mjs': {
      createScheduler() {
        return { register() {}, start() {}, stop() {}, async runOnce() {} };
      },
    },
  });
}

function makeSchedulerDeps(overrides = {}) {
  const calls = { generated: [], lastMessageChecks: [] };
  const deps = {
    now: new Date('2026-10-21T10:00:00'),
    today: '2026-10-21',
    hourThreshold: 8,
    activeWindowDays: 3,
    listEnabledPairs: async () => [
      { userId: 'user-1', agentId: 'companion-nari' },
      { userId: 'user-1', agentId: 'companion-lafei' },
    ],
    hasTodayRecord: async () => false,
    lastUserMessageAt: async (userId, agentId) => {
      calls.lastMessageChecks.push(agentId);
      return new Date('2026-10-21T08:00:00'); // 2 小时前，活跃
    },
    generate: async (agentId, userId) => {
      calls.generated.push(`${userId}|${agentId}`);
      return {};
    },
    logger: { log() {}, warn() {} },
    ...overrides,
  };
  return { deps, calls };
}

test('daily study tick skips before the configured morning hour', async () => {
  const scheduler = await loadSchedulerModule();
  const { deps, calls } = makeSchedulerDeps({
    now: new Date('2026-10-21T05:30:00'), // 凌晨 5 点半
  });
  const result = await scheduler.runDailyStudyTick(deps);
  assert.equal(result.generated, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 0);
  assert.equal(calls.generated.length, 0);
});

test('daily study tick skips agents that already have today record', async () => {
  const scheduler = await loadSchedulerModule();
  const { deps, calls } = makeSchedulerDeps({
    hasTodayRecord: async (agentId) => agentId === 'companion-nari',
  });
  const result = await scheduler.runDailyStudyTick(deps);
  assert.equal(result.generated, 1);
  assert.equal(result.skipped, 1);
  assert.deepEqual(calls.generated, ['user-1|companion-lafei']);
  // 已有记录的 Sunny 不应再查活跃度
  assert.deepEqual(calls.lastMessageChecks, ['companion-lafei']);
});

test('daily study tick puts dormant agents (no chat within 3 days) to sleep', async () => {
  const scheduler = await loadSchedulerModule();
  const { deps, calls } = makeSchedulerDeps({
    lastUserMessageAt: async (userId, agentId) =>
      agentId === 'companion-nari'
        ? new Date('2026-10-15T10:00:00') // 6 天前，休眠
        : new Date('2026-10-21T08:00:00'),
  });
  const result = await scheduler.runDailyStudyTick(deps);
  assert.equal(result.generated, 1);
  assert.equal(result.skipped, 1);
  assert.deepEqual(calls.generated, ['user-1|companion-lafei']);
});

test('daily study tick also sleeps agents the user never chatted with', async () => {
  const scheduler = await loadSchedulerModule();
  const { deps, calls } = makeSchedulerDeps({
    lastUserMessageAt: async () => null,
  });
  const result = await scheduler.runDailyStudyTick(deps);
  assert.equal(result.generated, 0);
  assert.equal(result.skipped, 2);
  assert.equal(calls.generated.length, 0);
});

test('daily study tick continues after a single agent failure', async () => {
  const scheduler = await loadSchedulerModule();
  const { deps, calls } = makeSchedulerDeps({
    generate: async (agentId, userId) => {
      if (agentId === 'companion-nari') throw new Error('LLM offline');
      calls.generated.push(`${userId}|${agentId}`);
      return {};
    },
  });
  const result = await scheduler.runDailyStudyTick(deps);
  assert.equal(result.generated, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(calls.generated, ['user-1|companion-lafei']);
});

test('daily study tick stops retrying after the configured daily attempt limit', async () => {
  const scheduler = await loadSchedulerModule();
  const state = { date: null, count: 0, nextAttemptAt: null };
  let now = new Date('2026-10-21T10:00:00');
  let attempts = 0;
  const { deps } = makeSchedulerDeps({
    now,
    maxAttempts: 2,
    retryBackoffMinutes: 30,
    listEnabledPairs: async () => [{
      userId: 'user-1',
      agentId: 'companion-nari',
      dailyStudyAttemptDate: state.date,
      dailyStudyAttemptCount: state.count,
      dailyStudyNextAttemptAt: state.nextAttemptAt,
    }],
    generate: async () => {
      attempts += 1;
      throw new Error('LLM offline');
    },
    recordAttempt: async (userId, agentId, next) => {
      state.date = next.date;
      state.count = next.count;
      state.nextAttemptAt = next.nextAttemptAt;
    },
  });

  let result = await scheduler.runDailyStudyTick(deps);
  assert.equal(result.failed, 1);
  assert.equal(attempts, 1);

  now = new Date('2026-10-21T10:31:00');
  deps.now = now;
  result = await scheduler.runDailyStudyTick(deps);
  assert.equal(result.failed, 1);
  assert.equal(attempts, 2);

  now = new Date('2026-10-21T11:31:00');
  deps.now = now;
  result = await scheduler.runDailyStudyTick(deps);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(attempts, 2);
});

test('daily study tick respects the configured learning window end', async () => {
  const scheduler = await loadSchedulerModule();
  const { deps, calls } = makeSchedulerDeps({
    now: new Date('2026-10-21T18:00:00'),
    windowEndHour: 18,
  });
  const result = await scheduler.runDailyStudyTick(deps);
  assert.equal(result.generated, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 0);
  assert.equal(calls.generated.length, 0);
});

test('daily study tick applies per-agent schedule overrides', async () => {
  const scheduler = await loadSchedulerModule();
  const { deps, calls } = makeSchedulerDeps({
    listEnabledPairs: async () => [{
      userId: 'user-1',
      agentId: 'companion-nari',
      dailyStudyStartHour: 12,
      dailyStudyWindowEndHour: 18,
      dailyStudyMaxAttempts: 1,
      dailyStudyRetryBackoffMinutes: 5,
    }],
    now: new Date('2026-10-21T10:00:00'),
  });
  const result = await scheduler.runDailyStudyTick(deps);
  assert.equal(result.generated, 0);
  assert.equal(result.failed, 0);
  assert.equal(calls.generated.length, 0);
});

test('buildRepresentativeExcerpt samples head, middle, and tail instead of blind front truncation', async () => {
  const kinds = await loadTsModule('lib/agent-study/content-kind.ts');
  const head = '开篇立论：我们今天讨论分布式缓存的一致性边界问题。'.repeat(25);
  const middle = '中段实验：在双写场景下延迟双删的参数需要控制在两百毫秒以上。'.repeat(25);
  const tail = '结尾复盘：最终工程落地必须配合消息队列重试与监控告警闭环。'.repeat(25);
  const longText = `${head}\n${middle}\n${tail}`;

  const excerpt = kinds.buildRepresentativeExcerpt(longText, 900);
  assert.ok(excerpt.includes('【开篇部分】'));
  assert.ok(excerpt.includes('【中段展开】'));
  assert.ok(excerpt.includes('【结尾结论】'));
  assert.ok(excerpt.includes('分布式缓存的一致性'));
  assert.ok(excerpt.includes('延迟双删的参数'));
  assert.ok(excerpt.includes('最终工程落地'));
});

test('enrichAgentPersona and synthesizeKnowledgeDocument preserve agent lens and handle multi-chapter long transcripts', async () => {
  const prompts = [];
  const assessor = await loadTsModule('lib/agent-study/knowledge-assessor.ts', {
    '@/lib/core/model-client': {
      createModelClient() {
        return {
          chat: {
            completions: {
              async create({ messages }) {
                const userPrompt = messages.find((m) => m.role === 'user')?.content || '';
                prompts.push(userPrompt);
                if (userPrompt.includes('当前章节原文片段')) {
                  return {
                    choices: [
                      {
                        message: {
                          content:
                            '- 本部分核心主题：情绪生理唤醒与认知重评机制\n- 关键证据：呼吸频率控制在每分钟6次可显著提升心率变异性 `HRV>60ms`，三栏表记录自动思维',
                        },
                      },
                    ],
                  };
                }
                return {
                  choices: [
                    {
                      message: {
                        content: [
                          '```markdown',
                          '## 角色研习导读与核心结论',
                          'Sunny 觉得这套情绪调节与认知重评方法非常值得放进花房笔记里。',
                          '## 关键知识点与原文证据',
                          '1. **认知重评**：通过识别自动化思维并寻找替代解释降低杏仁核激活度（原文证据：`HRV>60ms`）。',
                          '## 方法论与实操步骤',
                          '1. 记录触发事件；2. 标注情绪强度；3. 写出三种替代解释。',
                          '## 易错点与边界条件',
                          '- 不要在极度崩溃时强行讲道理，先做呼吸着陆。',
                          '## 专属融合：角色应用与复习自测',
                          '- **在「Sunny」场景中的应用**：当用户深夜倾诉焦虑时，先共情再引导认知重评。',
                          '- **一句话复习**：「就像给暴风雨里的花苗搭个小棚子，先护住情绪再慢慢梳理根系。」',
                          '- **自测思考题**：Q: 极度焦虑时第一步该做什么？A: 先做生理呼吸着陆，而非直接强行理性辩论。',
                          '```',
                        ].join('\n'),
                      },
                    },
                  ],
                };
              },
            },
          },
        };
      },
      resolveModelName() {
        return 'test-model';
      },
    },
  });
  const kinds = await loadTsModule('lib/agent-study/content-kind.ts');

  // 1. 验证不同 Agent 的专属研习透镜（studyLens）
  const sunny = assessor.enrichAgentPersona({ id: 'companion-nari', name: 'Sunny' });
  assert.ok(sunny.studyLens.includes('温暖治愈'));
  const lafei = assessor.enrichAgentPersona({ id: 'companion-lafei', name: '拉菲' });
  assert.ok(lafei.studyLens.includes('敏锐品鉴家'));

  // 2. 验证超过 9000 字的超长字幕触发分章提炼 + 角色终稿合成，且自动剥离外层代码块并附上溯源头
  const longTranscript = [
    '第一部分：情绪识别与生理唤醒机制，讲解呼吸频率与心率变异性的实测数据。'.repeat(120),
    '第二部分：认知重评的具体步骤，包含三栏法记录表与替代性解释训练。'.repeat(120),
    '第三部分：常见误区与复盘自测，分析为什么压抑情绪反而导致反弹效应。'.repeat(120),
  ].join('\n\n');
  assert.ok(longTranscript.length > 9000);

  const item = {
    id: 'bili-1',
    source: 'bilibili',
    sourceName: 'B站',
    title: '心理学：认知重评实操指南',
    url: 'https://www.bilibili.com/video/BV1test',
    summary: '讲解认知重评',
    thoughts: '很温暖实用',
    learnedAt: '2026-10-21T00:00:00.000Z',
  };
  const assessment = {
    id: 'bili-1',
    contentKind: 'knowledge',
    title: '认知重评与情绪着陆实操笔记',
    summary: '结合生理着陆与三栏认知重评的情绪调节方法论。',
    keyPoints: ['生理呼吸着陆', '三栏法认知重评'],
    category: '心理成长',
    confidence: 0.92,
  };

  const synthesized = await assessor.synthesizeKnowledgeDocument({
    agent: { id: 'companion-nari', name: 'Sunny' },
    item,
    assessment,
    rawContent: longTranscript,
  });

  assert.ok(synthesized, 'synthesized markdown should not be null');
  assert.ok(prompts.some((p) => p.includes('当前章节原文片段')), 'should run chapter condensation on >9000 chars');
  assert.ok(prompts.some((p) => p.includes('专属研习透镜')), 'should inject agent studyLens into synthesis prompt');
  assert.ok(!synthesized.includes('```markdown'), 'outer markdown code fence should be stripped');

  const doc = kinds.buildStudyKnowledgeMarkdown({
    item,
    assessment,
    date: '2026-10-21',
    content: longTranscript,
    synthesizedContent: synthesized,
    agentName: 'Sunny',
  });
  assert.match(doc, /^# 认知重评与情绪着陆实操笔记/);
  assert.ok(doc.includes('研习者：Sunny'));
  assert.ok(doc.includes('## 角色研习导读与核心结论'));
  assert.ok(doc.includes('## 专属融合：角色应用与复习自测'));

  // 3. 旧版技能卡提取仍兼容，但不再通过个人记忆注入对话。
  const skillCard = kinds.extractStudySkillMemory({
    title: assessment.title,
    summary: assessment.summary,
    keyPoints: assessment.keyPoints,
    synthesizedContent: synthesized,
  });
  assert.ok(skillCard && skillCard.includes('【认知重评与情绪着陆实操笔记】'));
  assert.ok(skillCard.includes('适用场景：当用户深夜倾诉焦虑时'));
  assert.ok(skillCard.includes('方法要点：'));
  assert.ok(skillCard.includes('角色心法：'));

  const personalMemory = await import('../agents/memory/agent-personal-memory.mjs');
  const injected = personalMemory.personalMemoryContext(
    [{ category: 'skill', content: skillCard, status: 'ACTIVE' }],
    '我今晚特别焦虑睡不着怎么办'
  );
  assert.equal(injected, '');
});


