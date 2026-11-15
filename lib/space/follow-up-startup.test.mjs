import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../../instrumentation.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;

async function boot(env, failFollowUp = false) {
  const calls = [], warnings = [];
  const exports = {};
  vm.runInNewContext(output, {
    exports, process: { env },
    console: { log() {}, warn: (...args) => warnings.push(args.join(' ')) },
    require(name) {
      if (name === './lib/space/follow-up-service') return { startSpaceFollowUpScheduler() {
        calls.push('follow-ups');
        if (failFollowUp) throw new Error('fixture startup failure');
      } };
      if (name === './lib/trending/scheduler') return { startTrendingScheduler: () => calls.push('trending') };
      if (name === './lib/workspace/crypto/sentinel-service') return { startCryptoSentinelScheduler: () => calls.push('sentinel') };
      if (name === './lib/agent-study/scheduler') return { startAgentStudyScheduler: () => calls.push('study') };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  await exports.register();
  return { calls, warnings };
}

test('production server startup registers the saved follow-up scheduler', async () => {
  const result = await boot({ NEXT_RUNTIME: 'nodejs', NODE_ENV: 'production' });
  assert.deepEqual(result.calls, ['follow-ups', 'trending', 'sentinel', 'study']);
  assert.equal(result.warnings.length, 0);
});

test('saved follow-ups still start when development background crawlers are disabled', async () => {
  const result = await boot({ NEXT_RUNTIME: 'nodejs', NODE_ENV: 'development' });
  assert.deepEqual(result.calls, ['follow-ups']);
});

test('edge instrumentation does not start a Node scheduler', async () => {
  assert.deepEqual((await boot({ NEXT_RUNTIME: 'edge', NODE_ENV: 'production' })).calls, []);
});

test('follow-up startup errors are visible without preventing the other schedulers from starting', async () => {
  const result = await boot({ NEXT_RUNTIME: 'nodejs', NODE_ENV: 'production' }, true);
  assert.deepEqual(result.calls, ['follow-ups', 'trending', 'sentinel', 'study']);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Failed to start space follow-up scheduler: fixture startup failure/);
});
