import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';

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
    '@/lib/model-client': {
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
      url: 'https://www.bilibili.com/video/BV1test',
      desc: '详细讲解蛋白打发和低温慢煎技巧',
      heat: '50万播放',
      matchScore: 10,
    },
  ];

  const result = await engine.distillDailyStudy(
    { name: 'Sunny', tone: '温柔' },
    candidates
  );

  assert.ok(result.greeting.length > 10, 'greeting must be meaningful');
  assert.equal(result.items.length, 1);
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
    '@/lib/model-client': {
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
          async upsert() { return {}; },
        },
      },
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
