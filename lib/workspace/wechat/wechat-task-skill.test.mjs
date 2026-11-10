import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { prepareWechatTaskSkill, readWechatMethod, selectWechatMethods, WECHAT_METHOD_FILES } from './wechat-task-skill.mjs';

const skill = { id: 'gzh-creator-suite', packagePath: 'creator-buddy-main', instructions: '单段严禁超90字', allowedTools: ['read_file', 'write_file'] };
test('WeChat methods follow the current step rather than unrelated background outputs', () => {
  assert.deepEqual(selectWechatMethods({ title: '写一篇短文', instruction: '后续可做封面' }), ['short']);
  assert.deepEqual(selectWechatMethods({ title: '完成长文正文' }), ['longform']);
  assert.deepEqual(selectWechatMethods({ title: '只改原稿开头' }), ['revision']);
  assert.deepEqual(selectWechatMethods({ title: '优化封面' }), ['cover']);
  assert.deepEqual(selectWechatMethods({ title: '标题优化' }), ['titles']);
});

test('WeChat loads only the matching method, preserves permissions and never injects the global root', async (t) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'wechat-methods-'));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const root = path.join(projectRoot, 'skills/creator-buddy-main');
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'SKILL.md'), 'DO NOT LOAD GLOBAL SEARCH ORCHESTRATOR');
  for (const [id, file] of Object.entries(WECHAT_METHOD_FILES)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), `METHOD:${id}`);
  }
  const shortReference = 'gzh-Skills/gzh-short-post/references/example.md';
  await mkdir(path.join(root, 'gzh-Skills/gzh-short-post/references'), { recursive: true });
  await writeFile(path.join(root, shortReference), 'SHORT METHOD EXAMPLE');
  await writeFile(path.join(root, WECHAT_METHOD_FILES.short), 'METHOD:short，参考 `references/example.md`');
  const prepared = await prepareWechatTaskSkill({ projectRoot, space: { workspaceType: 'WECHAT' }, task: { title: '写短文' }, skill });
  assert.match(prepared.instructions, /METHOD:short/);
  assert.doesNotMatch(prepared.instructions, /METHOD:longform|GLOBAL SEARCH|单段严禁超90字/);
  assert.deepEqual(prepared.allowedTools, skill.allowedTools);
  assert.deepEqual(prepared.referenceFiles, [WECHAT_METHOD_FILES.short, shortReference]);
  assert.match((await readWechatMethod({ projectRoot, skill: prepared, path: WECHAT_METHOD_FILES.short })).content, /METHOD:short/);
  assert.equal((await readWechatMethod({ projectRoot, skill: prepared, path: shortReference })).content, 'SHORT METHOD EXAMPLE');
  await assert.rejects(readWechatMethod({ projectRoot, skill: prepared, path: WECHAT_METHOD_FILES.longform }), /不属于/);
  await assert.rejects(readWechatMethod({ projectRoot, skill: prepared, path: 'SKILL.md' }), /不属于/);
  assert.equal(skill.instructions, '单段严禁超90字', 'stored snapshot is not mutated');
  const revision = await prepareWechatTaskSkill({ projectRoot, space: { templateId: 'wechat-article' }, task: { title: '只改开头' }, skill });
  assert.match(revision.instructions, /保留未要求改动的段落/);
  assert.doesNotMatch(revision.instructions, /METHOD:|GLOBAL SEARCH/);
});

test('other spaces and user-installed skills retain their original instructions', async () => {
  assert.equal(await prepareWechatTaskSkill({ space: { templateId: 'bilibili-creator' }, skill }), skill);
  const installed = { ...skill, id: 'space:custom' };
  assert.equal(await prepareWechatTaskSkill({ space: { workspaceType: 'WECHAT' }, skill: installed }), installed);
});
