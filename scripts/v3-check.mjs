import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function testFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...testFiles(target));
    else if (entry.name.endsWith('.test.mjs')) files.push(target);
  }
  return files.sort();
}

function run(label, command, args) {
  console.log(`\n[V3] ${label}`);
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

const ownedTestFiles = ['lib', 'worker', 'scripts', 'tests'].flatMap((directory) => testFiles(path.join(projectRoot, directory)));

run('自动化测试', process.execPath, ['--test', ...ownedTestFiles]);
run('TypeScript', path.join(projectRoot, 'node_modules', '.bin', 'tsc'), ['--noEmit']);
run('Worker 语法', process.execPath, ['--check', path.join(projectRoot, 'worker', 'agent-runtime.mjs')]);
run('Diff 格式', 'git', ['diff', '--check']);
console.log('\n[V3] 全部检查通过');
