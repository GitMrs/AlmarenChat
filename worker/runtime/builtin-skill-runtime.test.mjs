import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { prepareWorkspaceAttempt } from '../../lib/workspace-staging.mjs';
import { getSpaceSkill, installSpaceSkillPackage, updateSpaceSkillExecution, validateSpaceSkillPackage } from '../../lib/space-skills.mjs';
import { executeBuiltinSkill, executeSkill } from './builtin-skill-runtime.mjs';

const sourceProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceSkillRoot = path.join(sourceProjectRoot, 'skills', 'builtin', 'csv-business-analysis');
const sourceCsv = path.join(sourceProjectRoot, 'tests', 'fixtures', 'skills', 'csv-business-analysis', 'fixtures', 'sales.csv');
const roots = [];
const sandboxUsable = process.platform === 'darwin'
  ? spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1) (allow default)', '--', '/usr/bin/true'], { timeout: 5_000 }).status === 0
  : process.platform === 'linux'
    ? ['/usr/bin/bwrap', '/bin/bwrap', '/usr/local/bin/bwrap'].some((command) =>
        spawnSync(command, ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent', '--', 'true'], {
          timeout: 5_000,
          stdio: 'ignore',
        }).status === 0
      )
    : false;

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function scenario() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-builtin-skill-'));
  roots.push(projectRoot);
  await mkdir(path.join(projectRoot, 'skills', 'builtin'), { recursive: true });
  await cp(sourceSkillRoot, path.join(projectRoot, 'skills', 'builtin', 'csv-business-analysis'), { recursive: true });
  const workspace = path.join(projectRoot, 'data', 'spaces', 'user-1', 'space-1', 'workspace');
  await mkdir(workspace, { recursive: true });
  await cp(sourceCsv, path.join(workspace, 'sales.csv'));
  const workspaceOptions = {
    projectRoot,
    userId: 'user-1',
    spaceId: 'space-1',
    taskId: 'task-1',
    attempt: 1,
  };
  await prepareWorkspaceAttempt(workspaceOptions);
  return { projectRoot, workspaceOptions };
}

test('built-in Skill runtime executes only the registered entrypoint and returns artifacts', { skip: !sandboxUsable }, async () => {
  const { projectRoot, workspaceOptions } = await scenario();
  const result = await executeBuiltinSkill({
    projectRoot,
    skillId: 'csv-business-analysis',
    entrypoint: 'analyze',
    args: {
      input: 'sales.csv',
      markdownOutput: 'outputs/analysis.md',
      htmlOutput: 'outputs/report.html',
    },
    workspaceOptions,
  });
  assert.equal(result.ok, true, result.stderr);
  assert.deepEqual(result.paths, ['outputs/analysis.md', 'outputs/report.html']);
  const report = await readFile(path.join(
    projectRoot, 'data', 'spaces', 'user-1', 'space-1', 'staging', 'task-1', '1', 'workspace', 'outputs', 'analysis.md'
  ), 'utf8');
  assert.match(report, /8,500\.00/);
});

test('built-in Skill runtime rejects undeclared arguments before process execution', async () => {
  const { projectRoot, workspaceOptions } = await scenario();
  await assert.rejects(executeBuiltinSkill({
    projectRoot,
    skillId: 'csv-business-analysis',
    entrypoint: 'analyze',
    args: {
      input: 'sales.csv',
      markdownOutput: 'outputs/analysis.md',
      htmlOutput: 'outputs/report.html',
      command: 'bash -c whoami',
    },
    workspaceOptions,
  }), /参数未声明/);
});

test('built-in Skill runtime rejects unregistered entrypoints', async () => {
  const { projectRoot, workspaceOptions } = await scenario();
  await assert.rejects(executeBuiltinSkill({
    projectRoot,
    skillId: 'csv-business-analysis',
    entrypoint: 'shell',
    args: {},
    workspaceOptions,
  }), /入口未注册/);
});

async function spaceSkillScenario() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-space-skill-runtime-'));
  roots.push(projectRoot);
  const workspace = path.join(projectRoot, 'data', 'spaces', 'user-1', 'space-1', 'workspace');
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, 'chapter.md'), '第一章内容', 'utf8');
  const packageData = validateSpaceSkillPackage({
    sourceUrl: 'https://github.com/example/read-analyzer',
    files: [
      { path: 'SKILL.md', content: '---\nname: Read Analyzer\n---\n分析章节。' },
      { path: 'tools/analyze.py', content: 'from pathlib import Path\nimport sys\nprint(Path(sys.argv[1]).read_text(encoding="utf-8"))\n' },
    ],
  });
  const installed = await installSpaceSkillPackage({ projectRoot, userId: 'user-1', spaceId: 'space-1', packageData });
  await updateSpaceSkillExecution({
    projectRoot, userId: 'user-1', spaceId: 'space-1', skillId: installed.id,
    approvedScripts: ['tools/analyze.py'],
  });
  const skill = await getSpaceSkill({ projectRoot, userId: 'user-1', spaceId: 'space-1', skillId: installed.id });
  const workspaceOptions = { projectRoot, userId: 'user-1', spaceId: 'space-1', taskId: 'task-1', attempt: 1 };
  await prepareWorkspaceAttempt(workspaceOptions);
  return { projectRoot, skill, workspaceOptions };
}

test('Space Skill runtime executes an approved read-only Python analyzer', { skip: !sandboxUsable }, async () => {
  const { projectRoot, skill, workspaceOptions } = await spaceSkillScenario();
  const result = await executeSkill({
    projectRoot,
    skill,
    args: { script: 'tools/analyze.py', paths: ['chapter.md'] },
    workspaceOptions,
  });
  assert.equal(result.ok, true, result.stderr);
  assert.match(result.stdout, /第一章内容/);
  assert.deepEqual(result.paths, []);
});

test('Space Skill runtime rejects undeclared arguments before process execution', async () => {
  const { projectRoot, skill, workspaceOptions } = await spaceSkillScenario();
  await assert.rejects(executeSkill({
    projectRoot,
    skill,
    args: { script: 'tools/analyze.py', paths: ['chapter.md'], command: 'whoami' },
    workspaceOptions,
  }), /参数未声明/);
});
