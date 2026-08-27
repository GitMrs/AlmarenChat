import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareWorkspaceAttempt } from '../../lib/workspace-staging.mjs';
import { executeBuiltinSkill } from './builtin-skill-runtime.mjs';

const sourceProjectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
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
