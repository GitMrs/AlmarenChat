import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveTaskSkill,
  skillsForAgent,
  validateSkillArtifacts,
} from './skill-registry.mjs';

const frontend = { id: 'professional-frontend', name: '前端', description: '页面与组件实现' };
const product = { id: 'professional-product', name: '产品', description: '需求与产品方案' };
const writeAuthorization = { capabilities: ['workspace_read', 'workspace_write'] };

test('built-in skills are filtered by agent applicability', () => {
  assert.deepEqual(skillsForAgent(product).map((skill) => skill.id), [
    'professional-analysis', 'document-writer',
  ]);
  assert.deepEqual(skillsForAgent(frontend).map((skill) => skill.id), [
    'professional-analysis', 'document-writer', 'responsive-page-builder',
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

test('skill artifact contracts require the declared output type', () => {
  const skill = resolveTaskSkill({
    agent: frontend,
    text: '创建 index.html 页面',
    authorization: writeAuthorization,
  });
  assert.equal(validateSkillArtifacts(skill, [{ path: 'notes.md', change: 'CREATED' }]).valid, false);
  assert.equal(validateSkillArtifacts(skill, [{ path: 'index.html', change: 'CREATED' }]).valid, true);
});
