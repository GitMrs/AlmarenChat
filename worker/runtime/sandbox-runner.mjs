import { spawn } from 'node:child_process';
import { access, lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_ARGS = 64;
const COMMAND_CANDIDATES = Object.freeze({
  python3: ['/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3'],
  node: [process.execPath, '/usr/bin/node', '/usr/local/bin/node'],
});

function sbplString(value) {
  return `"${String(value).replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)}"`;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

async function canonicalDirectory(value, label) {
  const resolved = await realpath(path.resolve(String(value || '')));
  const info = await lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label}不是安全目录`);
  return resolved;
}

async function canonicalSkillScript(skillRoot, value) {
  const raw = String(value || '').trim().replaceAll('\\', '/');
  if (!raw || raw.startsWith('/') || raw.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Skill 入口脚本路径不安全');
  }
  const target = await realpath(path.join(skillRoot, raw));
  if (!target.startsWith(`${skillRoot}${path.sep}`)) throw new Error('Skill 入口脚本超出 Skill 目录');
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Skill 入口脚本不是安全文件');
  return { relative: raw, target };
}

async function resolveCommand(command) {
  const name = String(command || '').trim();
  const candidates = COMMAND_CANDIDATES[name];
  if (!candidates) throw new Error(`沙箱不支持运行命令：${name || '空命令'}`);
  for (const candidate of [...new Set(candidates)]) {
    try {
      await access(candidate, fsConstants.X_OK);
      return await realpath(candidate);
    } catch {
      // Try the next platform-specific candidate.
    }
  }
  throw new Error(`服务器没有安装 Skill 所需命令：${name}`);
}

async function existingPaths(values) {
  const result = [];
  for (const value of values) {
    try {
      await access(value, fsConstants.R_OK);
      result.push(value);
    } catch {
      // Optional system path is absent on this distribution.
    }
  }
  return result;
}

function seatbeltProfile({ workspaceRoot, skillRoot, tempRoot, network, workspaceAccess }) {
  const forms = [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* (literal ${sbplString('/dev/null')}) (subpath ${sbplString(tempRoot)}))`,
    `(deny file-read* (subpath ${sbplString(os.homedir())}))`,
    `(allow file-read* (subpath ${sbplString(workspaceRoot)}) (subpath ${sbplString(skillRoot)}) (subpath ${sbplString(tempRoot)}))`,
  ];
  if (workspaceAccess === 'write') {
    forms.push(`(allow file-write* (subpath ${sbplString(workspaceRoot)}))`);
  }
  if (!network) forms.push('(deny network*)');
  return forms.join(' ');
}

async function sandboxInvocation({ platform, workspaceRoot, skillRoot, script, executable, args, tempRoot, network, workspaceAccess }) {
  if (platform === 'darwin') {
    try {
      await access('/usr/bin/sandbox-exec', fsConstants.X_OK);
    } catch {
      throw new Error('macOS sandbox-exec 不可用，拒绝在宿主机直接执行 Skill');
    }
    return {
      backend: 'seatbelt',
      executable: '/usr/bin/sandbox-exec',
      args: ['-p', seatbeltProfile({ workspaceRoot, skillRoot, tempRoot, network, workspaceAccess }), '--', executable, script.target, ...args],
      cwd: workspaceRoot,
    };
  }

  if (platform === 'linux') {
    const bwrapCandidates = ['/usr/bin/bwrap', '/bin/bwrap', '/usr/local/bin/bwrap'];
    let bwrap = null;
    for (const candidate of bwrapCandidates) {
      try {
        await access(candidate, fsConstants.X_OK);
        bwrap = candidate;
        break;
      } catch {
        // Try the next standard location.
      }
    }
    if (!bwrap) throw new Error('Linux bubblewrap 不可用，拒绝在宿主机直接执行 Skill');
    const systemRoots = await existingPaths(['/usr', '/bin', '/lib', '/lib64', '/usr/local']);
    const systemFiles = await existingPaths(['/etc/ld.so.cache', '/etc/localtime']);
    const profile = ['--die-with-parent', '--new-session', '--unshare-all', '--clearenv'];
    for (const root of systemRoots) profile.push('--ro-bind', root, root);
    profile.push('--dir', '/etc');
    for (const file of systemFiles) profile.push('--ro-bind', file, file);
    profile.push(
      '--dev', '/dev',
      '--proc', '/proc',
      '--tmpfs', '/tmp',
      '--dir', '/tmp/home',
      '--ro-bind', skillRoot, '/skill',
      workspaceAccess === 'write' ? '--bind' : '--ro-bind', workspaceRoot, '/workspace',
      '--chdir', '/workspace',
      '--setenv', 'HOME', '/tmp/home',
      '--setenv', 'TMPDIR', '/tmp',
      '--setenv', 'PATH', '/usr/local/bin:/usr/bin:/bin',
      '--setenv', 'LANG', 'C.UTF-8',
      '--setenv', 'PYTHONDONTWRITEBYTECODE', '1'
    );
    if (!network) profile.push('--unshare-net');
    return {
      backend: 'bubblewrap',
      executable: bwrap,
      args: [...profile, '--', executable, `/skill/${script.relative}`, ...args],
      cwd: workspaceRoot,
    };
  }

  throw new Error(`当前平台 ${platform} 没有可用的强制沙箱后端`);
}

function appendOutput(state, chunk, limit) {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const remaining = Math.max(0, limit - state.bytes);
  if (remaining > 0) state.chunks.push(buffer.subarray(0, remaining));
  state.bytes += buffer.length;
  if (buffer.length > remaining) state.truncated = true;
}

function outputText(state) {
  const text = Buffer.concat(state.chunks).toString('utf8');
  return state.truncated ? `${text}\n[输出已截断]` : text;
}

function execute(invocation, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.executable, invocation.args, {
      cwd: invocation.cwd,
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        HOME: options.tempRoot,
        TMPDIR: options.tempRoot,
        PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
        LANG: 'C.UTF-8',
        PYTHONDONTWRITEBYTECODE: '1',
      },
    });
    const stdout = { chunks: [], bytes: 0, truncated: false };
    const stderr = { chunks: [], bytes: 0, truncated: false };
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    const startedAt = Date.now();

    const stopTree = (signal) => {
      if (!child.pid) return;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // The process may have exited between the state check and the signal.
      }
    };
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(cancelPoll);
      clearTimeout(forceKill);
      if (error) reject(error);
      else resolve(result);
    };

    child.stdout.on('data', (chunk) => appendOutput(stdout, chunk, options.maxOutputBytes));
    child.stderr.on('data', (chunk) => appendOutput(stderr, chunk, options.maxOutputBytes));
    child.on('error', (error) => finish(new Error(`沙箱进程启动失败：${error.message}`)));
    child.on('close', (exitCode, signal) => finish(null, {
      ok: exitCode === 0 && !timedOut && !cancelled,
      backend: invocation.backend,
      enforcement: 'full',
      exitCode,
      signal,
      timedOut,
      cancelled,
      durationMs: Date.now() - startedAt,
      stdout: outputText(stdout),
      stderr: outputText(stderr),
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
    }));

    const timeout = setTimeout(() => {
      timedOut = true;
      stopTree('SIGTERM');
    }, options.timeoutMs);
    timeout.unref?.();
    const forceKill = setTimeout(() => {
      if (timedOut || cancelled) stopTree('SIGKILL');
    }, options.timeoutMs + 500);
    forceKill.unref?.();
    const cancelPoll = setInterval(() => {
      if (!options.isCancelled?.()) return;
      cancelled = true;
      stopTree('SIGTERM');
    }, 100);
    cancelPoll.unref?.();
  });
}

export async function runSandboxedSkillProcess(options = {}) {
  if (options.network === true) {
    throw new Error('第一版 Skill Runner 尚未开放脚本联网；请使用平台受控联网工具');
  }
  const workspaceRoot = await canonicalDirectory(options.workspaceRoot, '任务工作区');
  const skillRoot = await canonicalDirectory(options.skillRoot, 'Skill 目录');
  const script = await canonicalSkillScript(skillRoot, options.script);
  const executable = await resolveCommand(options.command);
  const args = Array.isArray(options.args) ? options.args.map(String) : [];
  if (args.length > MAX_ARGS) throw new Error(`Skill 参数不能超过 ${MAX_ARGS} 个`);
  if (args.some((value) => value.includes('\0'))) throw new Error('Skill 参数包含无效字符');

  const timeoutMs = boundedNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 120_000);
  const maxOutputBytes = boundedNumber(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, 1_024, 1024 * 1024);
  const workspaceAccess = options.workspaceAccess === 'read' ? 'read' : 'write';
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-sandbox-'));
  await mkdir(path.join(tempRoot, 'home'));
  try {
    const invocation = await sandboxInvocation({
      platform: options.platform || process.platform,
      workspaceRoot,
      skillRoot,
      script,
      executable,
      args,
      tempRoot,
      network: false,
      workspaceAccess,
    });
    return await execute(invocation, {
      timeoutMs,
      maxOutputBytes,
      tempRoot,
      isCancelled: options.isCancelled,
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
