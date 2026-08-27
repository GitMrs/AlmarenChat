import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const fixtureRoot = path.dirname(new URL(import.meta.url).pathname);
const skillRoot = path.resolve(fixtureRoot, '../../../../skills/builtin/csv-business-analysis');

test('CSV analysis Skill declares a closed execution contract', async () => {
  const manifest = JSON.parse(await readFile(path.join(skillRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.id, 'csv-business-analysis');
  assert.equal(manifest.runtime.command, 'python3');
  assert.equal(manifest.runtime.network, 'forbidden');
  assert.equal(manifest.permissions.workspace, 'write');
  assert.deepEqual(manifest.permissions.networkDomains, []);
  assert.deepEqual(manifest.permissions.environment, []);
  assert.equal(manifest.entrypoints.analyze.script, 'scripts/analyze.py');
});

test('CSV analysis fixture generates deterministic Markdown and HTML reports', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'almaren-csv-skill-'));
  await cp(path.join(fixtureRoot, 'fixtures', 'sales.csv'), path.join(workspace, 'sales.csv'));

  const { stdout } = await execFileAsync('python3', [
    path.join(skillRoot, 'scripts', 'analyze.py'),
    '--input', 'sales.csv',
    '--markdown-output', 'outputs/analysis.md',
    '--html-output', 'outputs/report.html',
  ], {
    cwd: workspace,
    timeout: 10_000,
    env: { PATH: process.env.PATH || '' },
  });

  const markdown = await readFile(path.join(workspace, 'outputs', 'analysis.md'), 'utf8');
  const html = await readFile(path.join(workspace, 'outputs', 'report.html'), 'utf8');
  assert.match(stdout, /generated outputs\/analysis\.md and outputs\/report\.html/);
  assert.match(markdown, /## 总销售额\s+8,500\.00/);
  assert.match(markdown, /2026-07 为 3,500\.00，2026-08 为 5,000\.00，环比 \+42\.86%/);
  assert.match(markdown, /销售额非正数/);
  assert.match(markdown, /产品名称为空/);
  assert.match(markdown, /日期格式无效/);
  assert.match(markdown, /销售额不是数字/);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<meta name="viewport"/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('CSV analysis fixture rejects paths outside its workspace', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'almaren-csv-skill-path-'));
  await assert.rejects(
    execFileAsync('python3', [
      path.join(skillRoot, 'scripts', 'analyze.py'),
      '--input', '../sales.csv',
      '--markdown-output', 'outputs/analysis.md',
      '--html-output', 'outputs/report.html',
    ], { cwd: workspace, timeout: 10_000, env: { PATH: process.env.PATH || '' } }),
    /路径超出工作区/
  );
});
