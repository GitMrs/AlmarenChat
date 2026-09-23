import { accessSync, constants as fsConstants } from 'node:fs';

const BWRAP_CANDIDATES = ['/usr/bin/bwrap', '/bin/bwrap', '/usr/local/bin/bwrap'];
const SYSTEM_ROOTS = ['/usr', '/bin', '/lib', '/lib64', '/usr/local'];
const SYSTEM_FILES = ['/etc/ld.so.cache', '/etc/localtime'];
const RESERVED_ENV = new Set(['HOME', 'TMPDIR', 'PATH', 'LANG', 'NODE_ENV', 'PYTHONIOENCODING', 'PYTHONDONTWRITEBYTECODE', 'WORKSPACE_PATH']);

function readablePaths(paths) {
  return paths.filter((candidate) => {
    try {
      accessSync(candidate, fsConstants.R_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export function resolveBubblewrap() {
  for (const candidate of BWRAP_CANDIDATES) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next standard installation path.
    }
  }
  throw new Error('Linux bubblewrap 不可用，拒绝在宿主机直接执行脚本');
}

export function buildLinuxBubblewrapArguments({
  workspaceRoot,
  scriptRoot,
  scriptRelative,
  executable,
  executableArgs = [],
  args = [],
  workspaceAccess = 'write',
  environment = {},
  network = false,
}) {
  const sameRoot = scriptRoot === workspaceRoot;
  const scriptMount = sameRoot ? '/workspace' : '/script';
  const profile = ['--die-with-parent', '--new-session', '--unshare-all', '--clearenv', '--cap-drop', 'ALL'];
  for (const root of readablePaths(SYSTEM_ROOTS)) profile.push('--ro-bind', root, root);
  profile.push('--dir', '/etc');
  for (const file of readablePaths(SYSTEM_FILES)) profile.push('--ro-bind', file, file);
  profile.push(
    '--dev', '/dev',
    '--proc', '/proc',
    '--tmpfs', '/tmp',
    '--dir', '/tmp/home'
  );
  if (!sameRoot) profile.push('--ro-bind', scriptRoot, scriptMount);
  profile.push(
    workspaceAccess === 'read' ? '--ro-bind' : '--bind', workspaceRoot, '/workspace',
    '--chdir', '/workspace',
    '--setenv', 'HOME', '/tmp/home',
    '--setenv', 'TMPDIR', '/tmp',
    '--setenv', 'PATH', '/usr/local/bin:/usr/bin:/bin',
    '--setenv', 'LANG', 'C.UTF-8',
    '--setenv', 'NODE_ENV', 'production',
    '--setenv', 'PYTHONIOENCODING', 'utf-8',
    '--setenv', 'PYTHONDONTWRITEBYTECODE', '1',
    '--setenv', 'WORKSPACE_PATH', '/workspace'
  );
  for (const [name, rawValue] of Object.entries(environment)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || RESERVED_ENV.has(name)) {
      throw new Error(`Linux 沙箱环境变量不允许设置：${name}`);
    }
    const value = String(rawValue);
    if (value.includes('\0')) throw new Error(`Linux 沙箱环境变量包含无效字符：${name}`);
    profile.push('--setenv', name, value);
  }
  profile.push(network ? '--share-net' : '--unshare-net');
  profile.push('--', executable, ...executableArgs, `${scriptMount}/${scriptRelative}`, ...args);
  return profile;
}

export function createLinuxBubblewrapInvocation(options) {
  return {
    backend: 'bubblewrap',
    executable: resolveBubblewrap(),
    args: buildLinuxBubblewrapArguments(options),
    cwd: options.workspaceRoot,
  };
}
