import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveTaskSkill,
  spaceSkillReferenceToolSchema,
  skillsForAgent,
  validateSkillArtifacts,
} from './skill-registry.mjs';

const frontend = { id: 'professional-frontend', name: '前端', description: '页面与组件实现' };
const product = { id: 'professional-product', name: '产品', description: '需求与产品方案' };
const writeAuthorization = { capabilities: ['workspace_read', 'workspace_write'] };
const executeAuthorization = { capabilities: ['workspace_read', 'workspace_write', 'code_execute'] };

test('built-in skills are filtered by agent applicability', () => {
  assert.deepEqual(skillsForAgent(product).map((skill) => skill.id), [
    'professional-analysis', 'document-writer', 'csv-business-analysis',
  ]);
  assert.deepEqual(skillsForAgent(frontend).map((skill) => skill.id), [
    'image-generator', 'professional-analysis', 'document-writer', 'csv-business-analysis', 'responsive-page-builder',
  ]);
});

test('task skill selection keeps analysis read-only and chooses concrete file skills', () => {
  assert.equal(resolveTaskSkill({
    agent: product,
    text: '分析首页并给出正好 3 条建议',
    authorization: { capabilities: ['workspace_read'] },
  }).id, 'professional-analysis');
  assert.equal(resolveTaskSkill({
    agent: product,
    text: '编写 docs/spec.md 需求文档',
    authorization: writeAuthorization,
  }).id, 'document-writer');
  assert.equal(resolveTaskSkill({
    agent: frontend,
    text: '创建响应式 index.html 页面',
    authorization: writeAuthorization,
  }).id, 'responsive-page-builder');
  assert.equal(resolveTaskSkill({
    agent: product,
    text: '分析 sales.csv 并生成 analysis.md 和 report.html 报告',
    authorization: executeAuthorization,
  }).id, 'csv-business-analysis');
});

test('executable skills require explicit code execution authorization', () => {
  assert.throws(() => resolveTaskSkill({
    requestedSkillId: 'csv-business-analysis',
    agent: product,
    text: '分析 sales.csv 并生成 analysis.md 和 report.html 报告',
    authorization: writeAuthorization,
  }), /code_execute/);
});

test('skill selection cannot expand authorization or use an incompatible member', () => {
  assert.throws(() => resolveTaskSkill({
    requestedSkillId: 'document-writer',
    agent: product,
    text: '编写 report.md',
    authorization: { capabilities: ['workspace_read'] },
  }), /未授权能力/);
  assert.throws(() => resolveTaskSkill({
    requestedSkillId: 'responsive-page-builder',
    agent: product,
    text: '创建 index.html',
    authorization: writeAuthorization,
  }), /不适用/);
});

test('CSV analysis requires both declared report artifacts', () => {
  const skill = resolveTaskSkill({
    agent: product,
    text: '分析 sales.csv 并生成 analysis.md 和 report.html 报告',
    authorization: executeAuthorization,
  });
  assert.equal(validateSkillArtifacts(skill, [{ path: 'analysis.md', change: 'CREATED' }]).valid, false);
  assert.equal(validateSkillArtifacts(skill, [
    { path: 'analysis.md', change: 'CREATED' },
    { path: 'report.html', change: 'CREATED' },
  ]).valid, true);
});

test('skill artifact contracts require the declared output type', () => {
  const skill = resolveTaskSkill({
    agent: frontend,
    text: '创建 index.html 页面',
    authorization: writeAuthorization,
  });
  assert.equal(validateSkillArtifacts(skill, [{ path: 'notes.md', change: 'CREATED' }]).valid, false);
  assert.equal(validateSkillArtifacts(skill, [{ path: 'index.html', change: 'CREATED' }]).valid, true);
});

test('image generation is selected only inside the explicit capability boundary', () => {
  const text = '生成一张首页配图并保存到 assets 目录';
  assert.equal(resolveTaskSkill({
    agent: frontend,
    text,
    authorization: { capabilities: ['workspace_read', 'workspace_write', 'image_generate'] },
  }).id, 'image-generator');
  assert.notEqual(resolveTaskSkill({
    agent: frontend,
    text,
    authorization: { capabilities: ['workspace_read', 'workspace_write'] },
  }).id, 'image-generator');
});

test('explicit space skills are resolved from the server-provided snapshot only', () => {
  const spaceSkill = {
    id: 'space:review', name: '空间审查', version: 'abc123', description: '审查当前交付',
    requiredCapabilities: [], allowedTools: ['list_files', 'read_file'], artifactExtensions: [],
    instructions: '只审查当前范围。', execution: null,
  };
  const selected = resolveTaskSkill({
    requestedSkillId: spaceSkill.id,
    agent: product,
    text: '审查当前方案',
    authorization: { capabilities: ['workspace_read'] },
    additionalSkills: [spaceSkill],
  });
  assert.equal(selected.id, spaceSkill.id);
  assert.equal(selected.instructions, spaceSkill.instructions);
  assert.equal(spaceSkillReferenceToolSchema({
    ...selected,
    referenceFiles: ['references/checklist.md'],
  }).function.parameters.properties.path.enum[0], 'references/checklist.md');
  assert.throws(() => resolveTaskSkill({
    requestedSkillId: spaceSkill.id,
    agent: product,
    text: '审查当前方案',
    authorization: { capabilities: ['workspace_read'] },
  }), /未知 Skill/);
});
