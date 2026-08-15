import assert from 'node:assert/strict';
import test from 'node:test';
import { createExecutionConvergence } from './execution-convergence.mjs';

const tools = ['read_file', 'patch_file', 'check_files'].map((name) => ({ type: 'function', function: { name } }));

test('requires a check after repeated mutations and closes tools after validation', () => {
  const convergence = createExecutionConvergence(2);
  convergence.recordTool('patch_file', { path: 'index.html' }, { ok: true });
  assert.equal(convergence.availableTools(tools).length, 3);

  convergence.recordTool('patch_file', { path: 'index.html' }, { ok: true });
  assert.deepEqual(convergence.availableTools(tools).map((tool) => tool.function.name), ['check_files']);

  convergence.recordTool('check_files', { paths: ['index.html'] }, { valid: true });
  assert.deepEqual(convergence.availableTools(tools), []);
});

test('allows corrections after a failed check', () => {
  const convergence = createExecutionConvergence(1);
  convergence.recordTool('write_file', { path: 'report.md' }, { ok: true });
  convergence.recordTool('check_files', { paths: ['report.md'] }, { valid: false });
  assert.equal(convergence.availableTools(tools).length, 3);
});
