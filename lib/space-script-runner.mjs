import { spawn, spawnSync } from 'node:child_process';
import { stat, realpath } from 'node:fs/promises';
import { statSync, realpathSync } from 'node:fs';
import path from 'node:path';

const MAX_SCRIPT_OUTPUT_CHARS = 30_000;
const DEFAULT_SCRIPT_TIMEOUT_MS = 60_000;

let resolvedPython = null;

// 探测候选解释器，要求确实是 Python 3（防止命中 Linux 的 Python 2 或 Windows 商店占位程序）
function probePython(candidate) {
  try {
    const result = spawnSync(candidate[0], [...candidate.slice(1), '--version'], {
      shell: false,
      windowsHide: true,
      encoding: 'utf-8',
      timeout: 4_000,
    });
    const text = `${result.stdout || ''}${result.stderr || ''}`;
    const match = text.match(/Python\s+(\d+)\.(\d+)/);
    return result.status === 0 && Boolean(match) && Number(match[1]) >= 3;
  } catch {
    return false;
  }
}

// 解析可用的 Python 3 解释器，结果只探测一次并缓存
function resolvePython() {
  if (resolvedPython) return resolvedPython;

  const override = (process.env.SPACE_SCRIPT_PYTHON || process.env.PYTHON_BIN || '').trim();
  const candidates = override
    ? [override.split(/\s+/)]
    : process.platform === 'win32'
      ? [['python'], ['py', '-3'], ['python3']]
      : [['python3'], ['python']];

  for (const candidate of candidates) {
    if (probePython(candidate)) {
      resolvedPython = candidate;
      return candidate;
    }
  }
  throw new Error('未找到可用的 Python 3 解释器，请安装 Python 3，或通过环境变量 SPACE_SCRIPT_PYTHON 指定解释器路径');
}

function resolveScriptInterpreter(scriptPath) {
  const ext = path.extname(scriptPath).toLowerCase();
  if (ext === '.py') {
    const [executable, ...args] = resolvePython();
    return { executable, args };
  }
  if (['.mjs', '.js', '.cjs'].includes(ext)) {
    return { executable: process.execPath, args: [] };
  }
  throw new Error(`不支持执行此格式的脚本：${ext || '无扩展名'}`);
}

/**
 * 在空间的工作区安全执行指定脚本
 * @param {Object} options
 * @param {string} options.projectRoot - 项目根目录
 * @param {string} options.userId - 用户 ID
 * @param {string} options.spaceId - 空间 ID
 * @param {string} options.scriptPath - 脚本相对工作区的路径（如 'shared/fetch_and_filter.py'）
 * @param {number} [options.timeoutMs] - 超时时间，默认 60000 毫秒
 * @param {number} [options.maxOutputChars] - 最大输出字符数
 */
export async function executeSpaceScript({
  projectRoot,
  userId,
  spaceId,
  scriptPath,
  timeoutMs = DEFAULT_SCRIPT_TIMEOUT_MS,
  maxOutputChars = MAX_SCRIPT_OUTPUT_CHARS,
}) {
  const cleanPath = String(scriptPath || '').trim().replaceAll('\\', '/');
  if (!cleanPath || cleanPath.startsWith('/') || cleanPath.startsWith('~')) {
    throw new Error('脚本路径格式无效');
  }

  const workspaceBase = path.resolve(projectRoot, 'data', 'spaces', userId, spaceId, 'workspace');
  const targetScript = path.resolve(workspaceBase, cleanPath);

  // 防路径穿越检查
  if (!targetScript.startsWith(workspaceBase + path.sep) && targetScript !== workspaceBase) {
    throw new Error('脚本路径超出空间工作区安全范围');
  }

  const [actualWorkspace, actualScript] = await Promise.all([
    realpath(workspaceBase).catch(() => { throw new Error('空间工作区目录不存在'); }),
    realpath(targetScript).catch(() => { throw new Error(`空间工作区中找不到脚本文件：${cleanPath}`); }),
  ]);

  if (!actualScript.startsWith(actualWorkspace + path.sep)) {
    throw new Error('脚本解析路径超出工作区安全范围');
  }

  const scriptStat = await stat(actualScript);
  if (!scriptStat.isFile()) {
    throw new Error(`指定路径不是有效脚本文件：${cleanPath}`);
  }

  const interpreter = resolveScriptInterpreter(actualScript);
  const effectiveTimeout = Math.min(180_000, Math.max(1_000, Number(timeoutMs) || DEFAULT_SCRIPT_TIMEOUT_MS));

  return new Promise((resolve) => {
    const child = spawn(interpreter.executable, [...interpreter.args, actualScript], {
      cwd: workspaceBase,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        NODE_ENV: 'production',
        WORKSPACE_PATH: workspaceBase,
      },
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 3000);
    }, effectiveTimeout);

    child.stdout.on('data', (chunk) => {
      if (stdout.length < maxOutputChars * 2) {
        stdout += chunk.toString('utf-8');
      }
    });

    child.stderr.on('data', (chunk) => {
      if (stderr.length < maxOutputChars) {
        stderr += chunk.toString('utf-8');
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        exitCode: -1,
        stdout: stdout.slice(0, maxOutputChars),
        stderr: (stderr + '\n' + (err?.message || String(err))).trim(),
        timedOut: false,
        scriptPath: cleanPath,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const isSuccess = code === 0 && !timedOut;
      resolve({
        ok: isSuccess,
        exitCode: code ?? (timedOut ? -2 : -1),
        stdout: stdout.slice(0, maxOutputChars),
        stderr: stderr.slice(0, maxOutputChars),
        timedOut,
        scriptPath: cleanPath,
      });
    });
  });
}

/**
 * 同步执行空间工作区脚本（用于调度事务与即时处理）
 */
export function executeSpaceScriptSync({
  projectRoot = process.cwd(),
  userId,
  spaceId,
  scriptPath,
  timeoutMs = DEFAULT_SCRIPT_TIMEOUT_MS,
  maxOutputChars = MAX_SCRIPT_OUTPUT_CHARS,
}) {
  const cleanPath = String(scriptPath || '').trim().replaceAll('\\', '/');
  if (!cleanPath || cleanPath.startsWith('/') || cleanPath.startsWith('~')) {
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      stderr: '脚本路径格式无效',
      timedOut: false,
      scriptPath: cleanPath,
    };
  }

  const workspaceBase = path.resolve(projectRoot, 'data', 'spaces', userId, spaceId, 'workspace');
  const targetScript = path.resolve(workspaceBase, cleanPath);

  if (!targetScript.startsWith(workspaceBase + path.sep) && targetScript !== workspaceBase) {
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      stderr: '脚本路径超出空间工作区安全范围',
      timedOut: false,
      scriptPath: cleanPath,
    };
  }

  let actualWorkspace;
  let actualScript;
  try {
    actualWorkspace = realpathSync(workspaceBase);
  } catch (err) {
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      stderr: `空间工作区目录不存在: ${err?.message || err}`,
      timedOut: false,
      scriptPath: cleanPath,
    };
  }

  try {
    actualScript = realpathSync(targetScript);
  } catch (err) {
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      stderr: `空间工作区中找不到脚本文件：${cleanPath}`,
      timedOut: false,
      scriptPath: cleanPath,
    };
  }

  if (!actualScript.startsWith(actualWorkspace + path.sep)) {
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      stderr: '脚本解析路径超出工作区安全范围',
      timedOut: false,
      scriptPath: cleanPath,
    };
  }

  try {
    const scriptStat = statSync(actualScript);
    if (!scriptStat.isFile()) {
      return {
        ok: false,
        exitCode: -1,
        stdout: '',
        stderr: `指定路径不是有效脚本文件：${cleanPath}`,
        timedOut: false,
        scriptPath: cleanPath,
      };
    }
  } catch (err) {
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      stderr: `无法读取脚本文件：${err?.message || err}`,
      timedOut: false,
      scriptPath: cleanPath,
    };
  }

  let interpreter;
  try {
    interpreter = resolveScriptInterpreter(actualScript);
  } catch (err) {
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      stderr: err?.message || String(err),
      timedOut: false,
      scriptPath: cleanPath,
    };
  }

  const effectiveTimeout = Math.min(180_000, Math.max(1_000, Number(timeoutMs) || DEFAULT_SCRIPT_TIMEOUT_MS));

  try {
    const result = spawnSync(interpreter.executable, [...interpreter.args, actualScript], {
      cwd: workspaceBase,
      shell: false,
      windowsHide: true,
      timeout: effectiveTimeout,
      encoding: 'utf-8',
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        NODE_ENV: 'production',
        WORKSPACE_PATH: workspaceBase,
      },
      maxBuffer: 10 * 1024 * 1024,
    });

    const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');
    const exitCode = result.status ?? (timedOut ? -2 : -1);
    const stdout = (result.stdout || '').slice(0, maxOutputChars);
    const stderr = (result.stderr || (result.error ? result.error.message : '')).slice(0, maxOutputChars);
    const ok = exitCode === 0 && !timedOut;

    return {
      ok,
      exitCode,
      stdout,
      stderr,
      timedOut,
      scriptPath: cleanPath,
    };
  } catch (err) {
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      stderr: err?.message || String(err),
      timedOut: false,
      scriptPath: cleanPath,
    };
  }
}

