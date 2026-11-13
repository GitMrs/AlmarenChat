import { randomBytes, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { link, lstat, mkdir, realpath, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MACOS_CONFIG_ALIAS = '.c';
export const macosKeychainDirectory = home => path.join(home, 'Library', 'Application Support', 'lark-cli');

function canonical(value) {
  try { return realpathSync(value); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return path.resolve(value); }
}
function literal(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function macosFeishuProfile({ binary, env, cwd } = {}) {
  const writable = env && cwd ? [env.LARKSUITE_CLI_CONFIG_DIR, env.LARKSUITE_CLI_DATA_DIR, cwd, env.TMPDIR, macosKeychainDirectory(env.HOME)].map(canonical) : [];
  const readPaths = ['/System', '/usr/lib', '/usr/share', '/Library/Apple/System', '/private/etc/ssl', ...writable];
  const readFiles = [binary || '/usr/bin/true', '/private/etc/hosts', '/private/etc/resolv.conf', '/private/etc/localtime', '/dev/null', '/dev/random', '/dev/urandom'].map(canonical);
  return [
    '(version 1)', '(deny default)',
    `(allow process-exec (literal ${literal(canonical(binary || '/usr/bin/true'))}))`,
    '(allow process-fork)', '(allow signal (target self))', '(allow sysctl-read)',
    '(allow file-read-metadata)',
    `(allow file-read* ${readPaths.map(value => `(subpath ${literal(value)})`).join(' ')} ${readFiles.map(value => `(literal ${literal(value)})`).join(' ')})`,
    `(allow file-write* (literal "/dev/null") ${writable.map(value => `(subpath ${literal(value)})`).join(' ')})`,
    '(allow network*)',
    // TLS/DNS services are allowed; the system credential keychain is not.
    '(allow mach-lookup (global-name "com.apple.trustd") (global-name "com.apple.trustd.agent") (global-name "com.apple.networkd") (global-name "com.apple.SystemConfiguration.configd") (global-name "com.apple.system.logger"))',
  ].join('\n');
}

export const macosSandboxProbeArgs = () => ['-p', macosFeishuProfile(), '--', '/usr/bin/true'];

async function privateDirectory(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('飞书隔离目录越界');
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { await mkdir(current, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('飞书隔离目录不允许符号链接');
  }
}

export async function prepareMacosFeishu(dirs) {
  // CLI 1.0.100 supports a file-first, raw 32-byte master key in this location.
  // Create an independent key before initialization, so no host Keychain is used.
  await mkdir(dirs.root, { recursive: true, mode: 0o700 });
  const keyDirectory = macosKeychainDirectory(dirs.account);
  for (const directory of [dirs.config, dirs.files, path.join(dirs.data, 'roaming'), path.join(dirs.data, 'local'), path.join(dirs.account, 'tmp'), keyDirectory]) {
    await privateDirectory(dirs.root, directory);
  }
  const keyPath = path.join(keyDirectory, 'master.key.file');
  try { await lstat(keyPath); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const temporary = keyPath + '.' + randomUUID();
    await writeFile(temporary, randomBytes(32), { mode: 0o600, flag: 'wx' });
    try { await link(temporary, keyPath); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    finally { await unlink(temporary); }
  }
  const info = await lstat(keyPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== 32 || (info.mode & 0o077)) throw new Error('飞书独立凭据密钥无效，请检查连接器数据目录');

  // A short relative config path keeps even long account paths below macOS's
  // 104-byte Unix socket limit. The CLI preserves CONFIG_DIR verbatim.
  const alias = path.join(dirs.files, MACOS_CONFIG_ALIAS);
  try { await symlink(dirs.config, alias); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!(await lstat(alias)).isSymbolicLink() || await realpath(alias) !== await realpath(dirs.config)) throw new Error('飞书配置目录别名无效');
}
