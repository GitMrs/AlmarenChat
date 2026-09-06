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
  assert.equal(SPACE_TEMPLATES.length, 8);
  assert.equal(new Set(SPACE_TEMPLATES.map((item) => item.id)).size, SPACE_TEMPLATES.length);
  for (const item of SPACE_TEMPLATES) {
    assert.ok(item.version >= 1);
    assert.ok(item.recommendedAgentIds.length >= 2 && item.recommendedAgentIds.length <= 6);
    assert.ok(item.workflow.length >= 3);
    assert.ok(item.deliverables.length >= 1);
    assert.ok(item.starterPrompts.length >= 2);
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

test('template snapshot records the actual configured members', () => {
  const item = getSpaceTemplate('simple-webpage');
  assert.deepEqual(spaceTemplateSnapshot(item, ['professional-product', 'professional-frontend']).configuredAgentIds, [
    'professional-product',
    'professional-frontend',
  ]);
  assert.equal(getSpaceTemplate('unknown'), null);
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
