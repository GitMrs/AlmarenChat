import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLinuxBubblewrapArguments } from './linux-bubblewrap.mjs';

test('bubblewrap profile isolates a workspace script and clears host state', () => {
  const args = buildLinuxBubblewrapArguments({
    workspaceRoot: '/srv/workspace',
    scriptRoot: '/srv/workspace',
    scriptRelative: 'shared/task.py',
    executable: '/usr/bin/python3',
    environment: { SPACE_AUTOMATION_ID: 'automation-1' },
  });

  assert.ok(args.includes('--unshare-all'));
  assert.ok(args.includes('--unshare-net'));
  assert.ok(args.includes('--clearenv'));
  assert.deepEqual(args.slice(args.indexOf('--cap-drop'), args.indexOf('--cap-drop') + 2), ['--cap-drop', 'ALL']);
  assert.deepEqual(args.slice(args.lastIndexOf('--') + 1), ['/usr/bin/python3', '/workspace/shared/task.py']);
  assert.ok(args.some((value, index) => value === '--bind' && args[index + 1] === '/srv/workspace' && args[index + 2] === '/workspace'));
  assert.ok(args.some((value, index) => value === '--setenv' && args[index + 1] === 'SPACE_AUTOMATION_ID' && args[index + 2] === 'automation-1'));
});

test('bubblewrap profile keeps skill arguments after the script entrypoint', () => {
  const args = buildLinuxBubblewrapArguments({
    workspaceRoot: '/srv/workspace',
    scriptRoot: '/srv/skill',
    scriptRelative: 'scripts/run.mjs',
    executable: '/usr/bin/node',
    args: ['input.csv'],
    workspaceAccess: 'read',
  });

  assert.deepEqual(args.slice(args.lastIndexOf('--') + 1), ['/usr/bin/node', '/script/scripts/run.mjs', 'input.csv']);
  assert.ok(args.some((value, index) => value === '--ro-bind' && args[index + 1] === '/srv/skill' && args[index + 2] === '/script'));
  assert.ok(args.some((value, index) => value === '--ro-bind' && args[index + 1] === '/srv/workspace' && args[index + 2] === '/workspace'));
});

test('bubblewrap profile rejects reserved environment overrides', () => {
  assert.throws(() => buildLinuxBubblewrapArguments({
    workspaceRoot: '/srv/workspace',
    scriptRoot: '/srv/workspace',
    scriptRelative: 'task.py',
    executable: '/usr/bin/python3',
    environment: { PATH: '/workspace/bin' },
  }), /不允许设置：PATH/);
});
