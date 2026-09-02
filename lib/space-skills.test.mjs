import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {
  getSpaceSkill,
  installSpaceSkillPackage,
  listSpaceSkills,
  parseSpaceSkillArchive,
  parseSkillMarkdown,
  readSpaceSkillFile,
  removeSpaceSkill,
  renameSpaceSkillDirectory,
  resolveSpaceSkillExecution,
  updateSpaceSkillExecution,
  validateSpaceSkillPackage,
} from './space-skills.mjs';

test('parses mini-agent style SKILL.md frontmatter', () => {
  const parsed = parseSkillMarkdown('---\ndescription: 代码审查助手\nwhen_to_use: 审查代码\n---\n\n按要求审查。');
  assert.equal(parsed.metadata.description, '代码审查助手');
  assert.equal(parsed.body, '按要求审查。');
});

test('validates an instruction-only package and ignores requested tool grants', () => {
  const result = validateSpaceSkillPackage({
    sourceUrl: 'https://github.com/example/review-skill',
    files: [{ path: 'SKILL.md', content: '---\nname: Review Skill\ndescription: 审查代码\nallowed-tools: [RunCommand]\n---\n只审查当前范围。' }],
  });
  assert.equal(result.manifest.id, 'space:review-skill');
  assert.equal(result.instructions, '只审查当前范围。');
  assert.equal('allowedTools' in result.manifest, false);
});

test('ignores repository metadata without allowing other unsupported files', () => {
  const result = validateSpaceSkillPackage({
    sourceUrl: 'https://github.com/example/novel-skill',
    files: [
      { path: '.gitignore', content: 'dynamic/' },
      { path: 'LICENSE', content: 'MIT' },
      { path: 'SKILL.md', content: '---\nname: Novel Skill\n---\n执行小说工作流。' },
      { path: 'templates/.gitignore', content: '*' },
      { path: 'templates/progress.md', content: '# 进度' },
    ],
  });
  assert.deepEqual(result.manifest.files, ['SKILL.md', 'templates/progress.md']);

  assert.throws(() => validateSpaceSkillPackage({
    sourceUrl: 'https://github.com/example/novel-skill',
    files: [
      { path: 'SKILL.md', content: '执行小说工作流。' },
      { path: 'NOTICE', content: 'unsupported' },
    ],
  }), /不支持此 Skill 文件类型/);
});

test('parses a wrapped Skill ZIP and keeps scripts inert', () => {
  const archive = new AdmZip();
  archive.addFile('novel-ops-main/SKILL.md', Buffer.from('---\nname: Novel Ops\n---\n执行小说工作流。'));
  archive.addFile('novel-ops-main/.gitignore', Buffer.from('dynamic/'));
  archive.addFile('novel-ops-main/LICENSE', Buffer.from('MIT'));
  archive.addFile('novel-ops-main/tools/metrics.py', Buffer.from('print("metrics")'));

  const result = parseSpaceSkillArchive({ archive: archive.toBuffer(), sourceName: 'novel-ops.zip' });
  assert.equal(result.manifest.id, 'space:novel-ops');
  assert.deepEqual(result.manifest.files, ['SKILL.md', 'tools/metrics.py']);
  assert.match(result.manifest.sourceUrl, /^upload:\/\/local\/novel-ops\.zip$/);
  assert.deepEqual(result.manifest.warnings, ['包内包含脚本文件；当前只作为参考资料保存，不会执行。']);
});

test('rejects oversized Skill ZIP entries before extraction', () => {
  const archive = new AdmZip();
  archive.addFile('SKILL.md', Buffer.from('执行工作流。'));
  archive.addFile('references/large.md', Buffer.alloc(128 * 1024 + 1, 65));
  assert.throws(() => parseSpaceSkillArchive({ archive: archive.toBuffer() }), /超过 128KB/);
});

test('retries transient Windows directory rename failures', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-space-skill-rename-'));
  const source = path.join(projectRoot, 'source');
  const target = path.join(projectRoot, 'target');
  let attempts = 0;
  const waits = [];
  await renameSpaceSkillDirectory(source, target, {
    renamePath: async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error('directory is busy'), { code: 'EPERM' });
    },
    wait: async (delayMs) => waits.push(delayMs),
  });
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [50, 100]);
});

test('falls back to direct installation when Windows keeps blocking directory rename', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-space-skill-fallback-'));
  const packageData = validateSpaceSkillPackage({
    sourceUrl: 'https://github.com/example/windows-skill',
    files: [
      { path: 'SKILL.md', content: '---\nname: Windows Skill\n---\n执行工作流。' },
      { path: 'tools/check.py', content: 'print("check")' },
    ],
  });
  const installed = await installSpaceSkillPackage({
    projectRoot,
    userId: 'user-1',
    spaceId: 'space-1',
    packageData,
    renameDirectory: async () => {
      throw Object.assign(new Error('directory remains busy'), { code: 'EPERM' });
    },
  });
  assert.equal(installed.id, 'space:windows-skill');
  const installedRoot = path.join(projectRoot, 'data/spaces/user-1/space-1/.space/skills');
  assert.match(await readFile(path.join(installedRoot, 'windows-skill/SKILL.md'), 'utf8'), /执行工作流/);
  assert.equal((await listSpaceSkills({ projectRoot, userId: 'user-1', spaceId: 'space-1' })).length, 1);
});

test('installs, lists, loads and removes a space skill', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-space-skill-'));
  const packageData = validateSpaceSkillPackage({
    sourceUrl: 'https://github.com/example/writing-skill',
    files: [
      { path: 'SKILL.md', content: '---\nname: Writing Skill\ndescription: 稳定文风\n---\n保持客观、简洁。' },
      { path: 'references/style.md', content: '# 风格\n避免绝对化表述。' },
    ],
  });
  const installed = await installSpaceSkillPackage({ projectRoot, userId: 'user-1', spaceId: 'space-1', packageData });
  assert.equal(installed.id, 'space:writing-skill');
  assert.equal((await listSpaceSkills({ projectRoot, userId: 'user-1', spaceId: 'space-1' })).length, 1);
  const skill = await getSpaceSkill({ projectRoot, userId: 'user-1', spaceId: 'space-1', skillId: installed.id });
  assert.match(skill.instructions, /客观/);
  assert.equal(skill.execution, null);
  assert.equal(skill.allowedTools.includes('run_skill'), false);
  const reference = await readSpaceSkillFile({
    projectRoot, userId: 'user-1', spaceId: 'space-1', skillId: installed.id,
    digest: skill.digest, relativePath: 'references/style.md', limit: 8,
  });
  assert.equal(reference.content, '# 风格\n避免绝');
  assert.equal(reference.hasMore, true);
  await assert.rejects(() => readSpaceSkillFile({
    projectRoot, userId: 'user-1', spaceId: 'space-1', skillId: installed.id,
    digest: 'wrong', relativePath: 'references/style.md',
  }), /版本已经变化/);
  const audit = await readFile(path.join(projectRoot, 'data/spaces/user-1/space-1/.space/skills/.audit.jsonl'), 'utf8');
  assert.match(audit, /"action":"install"/);
  assert.equal(await removeSpaceSkill({ projectRoot, userId: 'user-1', spaceId: 'space-1', skillId: installed.id }), true);
  assert.deepEqual(await listSpaceSkills({ projectRoot, userId: 'user-1', spaceId: 'space-1' }), []);
});

test('requires explicit approval before exposing Space Skill Python execution', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-space-skill-execution-'));
  const packageData = validateSpaceSkillPackage({
    sourceUrl: 'https://github.com/example/analysis-skill',
    files: [
      { path: 'SKILL.md', content: '---\nname: Analysis Skill\n---\n分析工作区文本。' },
      { path: 'tools/metrics.py', content: 'print("metrics")' },
      { path: 'tools/install.sh', content: 'echo install' },
    ],
  });
  const installed = await installSpaceSkillPackage({ projectRoot, userId: 'user-1', spaceId: 'space-1', packageData });
  assert.deepEqual(installed.scripts, ['tools/metrics.py']);
  assert.deepEqual(installed.approvedScripts, []);
  assert.equal(installed.executionEnabled, false);
  assert.equal((await getSpaceSkill({
    projectRoot, userId: 'user-1', spaceId: 'space-1', skillId: installed.id,
  })).execution, null);

  const updated = await updateSpaceSkillExecution({
    projectRoot, userId: 'user-1', spaceId: 'space-1', skillId: installed.id,
    approvedScripts: ['tools/metrics.py'],
  });
  assert.equal(updated.executionEnabled, true);
  const skill = await getSpaceSkill({ projectRoot, userId: 'user-1', spaceId: 'space-1', skillId: installed.id });
  assert.deepEqual(skill.requiredCapabilities, ['workspace_read', 'code_execute']);
  assert.equal(skill.allowedTools.includes('run_skill'), true);
  assert.deepEqual(skill.execution.parameters.properties.script.enum, ['tools/metrics.py']);
  assert.equal((await resolveSpaceSkillExecution({
    projectRoot, userId: 'user-1', spaceId: 'space-1', skillId: installed.id,
    digest: skill.digest, script: 'tools/metrics.py',
  })).script, 'tools/metrics.py');

  await assert.rejects(updateSpaceSkillExecution({
    projectRoot, userId: 'user-1', spaceId: 'space-1', skillId: installed.id,
    approvedScripts: ['tools/install.sh'],
  }), /只能批准/);
});

test('rejects path traversal and binary files', () => {
  assert.throws(() => validateSpaceSkillPackage({
    sourceUrl: 'https://github.com/example/bad-skill',
    files: [{ path: '../SKILL.md', content: 'bad' }],
  }), /不安全/);
  assert.throws(() => validateSpaceSkillPackage({
    sourceUrl: 'https://github.com/example/bad-skill',
    files: [{ path: 'SKILL.md', content: Buffer.from([0, 1, 2]) }],
  }), /二进制/);
});
