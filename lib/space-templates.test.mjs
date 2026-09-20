import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  getSpaceTemplate,
  SPACE_TEMPLATES,
  spaceTemplateInstructions,
  spaceTemplateSnapshot,
} from './space-templates.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('built-in space templates have stable unique ids and bounded teams', () => {
  assert.equal(SPACE_TEMPLATES.length, 9);
  assert.equal(new Set(SPACE_TEMPLATES.map((item) => item.id)).size, SPACE_TEMPLATES.length);
  for (const item of SPACE_TEMPLATES) {
    assert.ok(item.version >= 1);
    assert.ok(item.recommendedAgentIds.length >= 2 && item.recommendedAgentIds.length <= 6);
    assert.ok(item.workflow.length >= 3);
    assert.ok(item.deliverables.length >= 1);
    assert.ok(item.starterPrompts.length >= 2);
    assert.equal(item.version >= 2, true);
    assert.equal(item.workKind, item.id);
    assert.equal(item.supportsMultipleWorks, true);
    assert.deepEqual(item.lifecycleStages.map((stage) => stage.id), ['brief', 'production', 'review', 'ready']);
    assert.equal(item.defaultArtifacts.length, item.deliverables.length);
    assert.equal(item.completionCriteria.length, item.qualityRules.length);
  }
});

test('every recommended member is an existing Agent', async () => {
  const agents = JSON.parse(await readFile(path.join(projectRoot, 'src/lib/agent.json'), 'utf8'));
  const agentIds = new Set(agents.map((agent) => agent.identifier));
  for (const item of SPACE_TEMPLATES) {
    for (const agentId of item.recommendedAgentIds) {
      assert.equal(agentIds.has(agentId), true, `${item.id} references missing Agent ${agentId}`);
    }
  }
});

test('template instructions guide rather than hard-code coordinator dispatch', () => {
  const item = getSpaceTemplate('wechat-article');
  const instructions = spaceTemplateInstructions(item);
  assert.match(instructions, /简单任务直接交给一名合适成员/);
  assert.match(instructions, /默认交付物/);
  assert.match(instructions, /用户当次明确要求始终优先/);
});

test('wechat article template produces a separate copy-ready publication', () => {
  const item = getSpaceTemplate('wechat-article');
  assert.equal(item.version, 2);
  assert.match(item.deliverables.join('\n'), /article\.md.*只包含一个最终标题/);
  assert.match(item.deliverables.join('\n'), /publish-info\.md/);
  assert.match(item.qualityRules.join('\n'), /不得混入备选标题/);
  assert.deepEqual(spaceTemplateSnapshot(item).qualityRules, item.qualityRules);
});

test('course training template produces interactive slides and structured teaching materials', () => {
  const item = getSpaceTemplate('course-training');
  assert.equal(item.version, 2);
  assert.match(item.deliverables.join('\n'), /slides\.html/);
  assert.match(item.deliverables.join('\n'), /course-outline\.md/);
  assert.match(item.deliverables.join('\n'), /lesson-plan\.md/);
  assert.match(item.deliverables.join('\n'), /practice-tasks\.md/);
  const instructions = spaceTemplateInstructions(item);
  assert.match(instructions, /现代互动课件工坊指南/);
  assert.match(instructions, /需求对齐与共创机制/);
  assert.match(instructions, /梯次递进派发原则/);
  assert.match(instructions, /课件防截断与架构规范/);
  assert.match(instructions, /slides\.html/);
  assert.match(instructions, /免装插件/);
  assert.match(item.qualityRules.join('\n'), /正式制作前必须先向用户对齐受众画像与大纲结构/);
  assert.match(item.qualityRules.join('\n'), /防止 Token 超限截断/);
  assert.deepEqual(spaceTemplateSnapshot(item).qualityRules, item.qualityRules);
});

test('story writing template produces story bible and supports dual-track novel and script writing', () => {
  const item = getSpaceTemplate('story-writing');
  assert.equal(item.version, 2);
  assert.match(item.deliverables.join('\n'), /world-setting\.md/);
  assert.match(item.deliverables.join('\n'), /characters\.md/);
  assert.match(item.deliverables.join('\n'), /plot-outline\.md/);
  assert.match(item.deliverables.join('\n'), /chapters\/.*scenes\//);
  const instructions = spaceTemplateInstructions(item);
  assert.match(instructions, /专业虚构创作工坊指南/);
  assert.match(instructions, /故事圣经先行原则/);
  assert.match(instructions, /双轨自适应格式规范/);
  assert.match(instructions, /小说连载轨/);
  assert.match(instructions, /影视\/短剧剧本轨/);
  assert.match(instructions, /Show, don't tell/);
  assert.deepEqual(spaceTemplateSnapshot(item).qualityRules, item.qualityRules);
});

test('all 9 built-in templates have specialized industrial-grade instructions', () => {
  for (const item of SPACE_TEMPLATES) {
    const instructions = spaceTemplateInstructions(item);
    assert.ok(instructions.length > 200, `${item.id} instructions should be comprehensive`);
  }

  // Short video script
  const shortVideo = getSpaceTemplate('short-video-script');
  assert.match(shortVideo.deliverables.join('\n'), /script\.md/);
  assert.match(shortVideo.deliverables.join('\n'), /publish-copy\.md/);
  assert.match(spaceTemplateInstructions(shortVideo), /黄金完播率节奏模型/);
  assert.match(spaceTemplateInstructions(shortVideo), /5 列表格分镜/);

  // Product requirements
  const prd = getSpaceTemplate('product-requirements');
  assert.match(prd.deliverables.join('\n'), /prd\.md/);
  assert.match(prd.deliverables.join('\n'), /user-flow\.md/);
  assert.match(prd.deliverables.join('\n'), /acceptance-criteria\.md/);
  assert.match(spaceTemplateInstructions(prd), /本期范围 In-Scope/);
  assert.match(spaceTemplateInstructions(prd), /Gherkin/);

  // Simple webpage
  const webpage = getSpaceTemplate('simple-webpage');
  assert.match(webpage.deliverables.join('\n'), /index\.html/);
  assert.match(spaceTemplateInstructions(webpage), /自包含可预览规范/);

  // Research report
  const report = getSpaceTemplate('research-report');
  assert.match(report.deliverables.join('\n'), /report\.md/);
  assert.match(report.deliverables.join('\n'), /executive-summary\.md/);
  assert.match(spaceTemplateInstructions(report), /麦肯锡金字塔原理/);

  // Mystery puzzle
  const mystery = getSpaceTemplate('mystery-puzzle');
  assert.match(mystery.deliverables.join('\n'), /truth\.md/);
  assert.match(mystery.deliverables.join('\n'), /characters\//);
  assert.match(mystery.deliverables.join('\n'), /clues\.md/);
  assert.match(mystery.deliverables.join('\n'), /dm-guide\.md/);
  assert.match(spaceTemplateInstructions(mystery), /沉浸式探案与剧本杀工坊指南/);
  assert.match(spaceTemplateInstructions(mystery), /实机探案模式/);

  // Podcast dialogue
  const podcast = getSpaceTemplate('podcast-dialogue');
  assert.match(podcast.deliverables.join('\n'), /script\.md/);
  assert.match(podcast.deliverables.join('\n'), /shownotes\.md/);
  assert.match(spaceTemplateInstructions(podcast), /现代播客与圆桌对谈工坊指南/);
  assert.match(spaceTemplateInstructions(podcast), /实机交锋模式/);
});

test('mystery puzzle template supports dual-mode interactive interrogation and casebook export', () => {
  const item = getSpaceTemplate('mystery-puzzle');
  assert.equal(item.version, 2);
  assert.equal(item.name, '探案剧本杀');
  assert.deepEqual(item.recommendedAgentIds, ['detective-game-assistant', 'detective-novelist', 'lateral-thinking-puzzle', 'professional-game']);
  const instructions = spaceTemplateInstructions(item);
  assert.match(instructions, /实机探案模式/);
  assert.match(instructions, /出本创作模式/);
  assert.match(instructions, /核心诡计与逻辑严密性/);
  assert.match(instructions, /视角隔离与防剧透铁律/);
  assert.deepEqual(spaceTemplateSnapshot(item).qualityRules, item.qualityRules);
});

test('podcast dialogue template supports dual-mode round-table confrontation and recording script generation', () => {
  const item = getSpaceTemplate('podcast-dialogue');
  assert.equal(item.version, 2);
  assert.equal(item.name, '播客对谈');
  assert.deepEqual(item.recommendedAgentIds, ['gl-zmtyy', 'ruipingshi', 'human-writer-simulator', 'top-copywriting-master']);
  assert.match(item.deliverables.join('\n'), /script\.md/);
  assert.match(item.deliverables.join('\n'), /shownotes\.md/);
  assert.match(item.deliverables.join('\n'), /outline\.md/);
  assert.match(item.deliverables.join('\n'), /cover-info\.md/);
  const instructions = spaceTemplateInstructions(item);
  assert.match(instructions, /现代播客与圆桌对谈工坊指南/);
  assert.match(instructions, /实机交锋模式/);
  assert.match(instructions, /出稿录播模式/);
  assert.match(instructions, /现场感台本规范/);
  assert.match(instructions, /小宇宙标准时间轴/);
  assert.deepEqual(spaceTemplateSnapshot(item).qualityRules, item.qualityRules);
});

test('template snapshot records the actual configured members', () => {
  const item = getSpaceTemplate('simple-webpage');
  assert.deepEqual(spaceTemplateSnapshot(item, ['professional-product', 'professional-frontend']).configuredAgentIds, [
    'professional-product',
    'professional-frontend',
  ]);
  assert.equal(getSpaceTemplate('unknown'), null);
  const snapshot = spaceTemplateSnapshot(item);
  assert.equal(snapshot.workLabel, '网页');
  assert.equal(snapshot.supportsMultipleWorks, true);
  assert.deepEqual(snapshot.lifecycleStages.map((stage) => stage.id), ['brief', 'production', 'review', 'ready']);
});

test('space work lifecycle migration preserves rows and initializes active status', async () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE "SpaceWork" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "spaceId" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL,
      "updatedAt" DATETIME NOT NULL
    )`);
    db.prepare('INSERT INTO "SpaceWork" VALUES (?, ?, ?, ?, ?, ?)').run(
      'work-1', 'space-1', '已有文章', 'wechat-article', '2026-09-08', '2026-09-08'
    );
    const migration = await readFile(
      path.join(projectRoot, 'prisma/migrations/20260908230000_add_space_work_lifecycle/migration.sql'),
      'utf8'
    );
    db.exec(migration);
    const row = db.prepare('SELECT * FROM "SpaceWork" WHERE "id" = ?').get('work-1');
    assert.equal(row.title, '已有文章');
    assert.equal(row.status, 'ACTIVE');
    assert.equal(row.stage, null);
    assert.equal(row.completedAt, null);
  } finally {
    db.close();
  }
});

test('space template migration adds nullable snapshot columns without changing existing rows', async () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE "Space" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL)`);
    db.prepare('INSERT INTO "Space" ("id", "name") VALUES (?, ?)').run('space-1', '原空间');
    const migration = await readFile(
      path.join(projectRoot, 'prisma/migrations/20260906090000_add_space_templates/migration.sql'),
      'utf8'
    );
    db.exec(migration);
    const row = db.prepare('SELECT * FROM "Space" WHERE "id" = ?').get('space-1');
    assert.equal(row.name, '原空间');
    assert.equal(row.templateId, null);
    assert.equal(row.templateVersion, null);
    assert.equal(row.templateSnapshot, null);
  } finally {
    db.close();
  }
});
