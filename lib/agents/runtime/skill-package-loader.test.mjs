import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadSkillPackage } from './skill-package-loader.mjs';

test('loads the real root SKILL.md and discovers nested skill entries', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-skill-'));
  await mkdir(path.join(projectRoot, 'skills', 'creator-buddy-main', 'gzh-Skills', 'writer'), { recursive: true });
  await writeFile(path.join(projectRoot, 'skills', 'creator-buddy-main', 'SKILL.md'), '# Creator Buddy\nRoute tasks.');
  await writeFile(path.join(projectRoot, 'skills', 'creator-buddy-main', 'gzh-Skills', 'writer', 'SKILL.md'), '# Writer');
  await writeFile(path.join(projectRoot, 'skills', 'creator-buddy-main', 'gzh-Skills', 'writer', 'run.py'), 'print(1)');
  await writeFile(path.join(projectRoot, 'skills', 'creator-buddy-main', 'almaren.skill.json'), JSON.stringify({
    version: '1',
    entrypoints: [{ script: 'gzh-Skills/writer/run.py', runtime: 'python3', network: 'forbidden', workspace: 'read' }],
  }));

  const loaded = await loadSkillPackage({ projectRoot, packagePath: 'creator-buddy-main' });
  assert.match(loaded.instructions, /Creator Buddy/);
  assert.deepEqual(loaded.entryFiles, ['gzh-Skills/writer/SKILL.md']);
  assert.deepEqual(loaded.scripts, ['gzh-Skills/writer/run.py']);
  assert.equal(loaded.manifest.entrypoints[0].runtime, 'python3');
});

test('rejects traversal and packages outside the skills directory', async () => {
  await assert.rejects(
    loadSkillPackage({ projectRoot: '/tmp/project', packagePath: '../outside' }),
    /格式不安全|超出 skills/,
  );
});
