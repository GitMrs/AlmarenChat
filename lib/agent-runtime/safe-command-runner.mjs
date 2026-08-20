import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { workspaceAttemptFile } from '../workspace-staging.mjs';

const MAX_OUTPUT_CHARS = 12_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_INLINE_SCRIPTS = 20;
const MAX_INLINE_SCRIPT_CHARS = 128_000;
const CHECKS = {
  javascript: {
    extensions: new Set(['.js', '.mjs', '.cjs']),
    command: (projectRoot, target) => ({ executable: process.execPath, args: ['--check', target] }),
  },
  typescript: {
    extensions: new Set(['.ts', '.tsx']),
    command: (projectRoot, target) => ({
      executable: process.execPath,
      args: [
        path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
        '--noEmit',
        '--pretty',
        'false',
        '--skipLibCheck',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        '--jsx',
        'react-jsx',
        target,
      ],
    }),
  },
  html: {
    extensions: new Set(['.html', '.htm']),
  },
};

function boundedOutput(value) {
  const text = String(value || '');
  return text.length <= MAX_OUTPUT_CHARS ? text : `${text.slice(0, MAX_OUTPUT_CHARS)}\n[输出已截断]`;
}

function runCommand(command, { check, filePath, cwd, input, isCancelled, timeoutMs, startedAt }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      env: { NODE_ENV: 'test', NO_COLOR: '1', SYSTEMROOT: process.env.SYSTEMROOT || '', TEMP: process.env.TEMP || '' },
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(cancellationPoll);
      if (error) reject(error);
      else resolve(result);
    };
    child.stdout.on('data', (chunk) => { stdout = boundedOutput(stdout + chunk); });
    child.stderr.on('data', (chunk) => { stderr = boundedOutput(stderr + chunk); });
    child.on('error', (error) => finish(error));
    child.on('close', (exitCode, signal) => finish(null, {
      ok: exitCode === 0 && !timedOut && !cancelled,
      check,
      path: filePath,
      exitCode,
      signal,
      timedOut,
      cancelled,
      durationMs: Date.now() - startedAt,
      stdout: boundedOutput(stdout),
      stderr: boundedOutput(stderr),
    }));
    if (input !== undefined) child.stdin.end(input);
    const stop = () => child.kill('SIGKILL');
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    timeout.unref?.();
    const cancellationPoll = setInterval(() => {
      if (!isCancelled?.()) return;
      cancelled = true;
      stop();
    }, 100);
    cancellationPoll.unref?.();
  });
}

function inlineScripts(html) {
  const scripts = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(pattern)) {
    const attributes = match[1] || '';
    if (/\bsrc\s*=/i.test(attributes)) continue;
    const type = attributes.match(/\btype\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/i)?.slice(1).find(Boolean)?.toLowerCase() || '';
    if (type && !['module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(type)) continue;
    scripts.push({ source: match[2], module: type === 'module' });
  }
  return scripts;
}

export async function runSafeWorkspaceCheck(options, args = {}) {
  if (!options.taskId || !options.attempt) throw new Error('安全检查只能在任务暂存区执行');
  const check = String(args.check || '');
  const policy = CHECKS[check];
  if (!policy) throw new Error('不支持的安全检查类型');
  const file = workspaceAttemptFile(options, args.path);
  const extension = path.extname(file.target).toLowerCase();
  if (!policy.extensions.has(extension)) throw new Error(`当前检查不支持 ${extension || '无扩展名'} 文件`);
  const timeoutMs = Math.min(30_000, Math.max(1_000, Number(options.commandTimeoutMs || DEFAULT_TIMEOUT_MS)));
  const startedAt = Date.now();

  if (check !== 'html') {
    return runCommand(policy.command(options.projectRoot, file.target), {
      check,
      filePath: String(args.path || ''),
      cwd: file.root,
      isCancelled: options.isCancelled,
      timeoutMs,
      startedAt,
    });
  }

  const scripts = inlineScripts(await readFile(file.target, 'utf8'));
  if (scripts.length > MAX_INLINE_SCRIPTS) {
    return { ok: false, check, path: String(args.path || ''), error: `内联脚本超过 ${MAX_INLINE_SCRIPTS} 个` };
  }
  if (scripts.reduce((total, script) => total + script.source.length, 0) > MAX_INLINE_SCRIPT_CHARS) {
    return { ok: false, check, path: String(args.path || ''), error: '内联脚本内容过大' };
  }
  for (let index = 0; index < scripts.length; index += 1) {
    const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
    const script = scripts[index];
    const result = await runCommand({
      executable: process.execPath,
      args: ['--check', `--input-type=${script.module ? 'module' : 'commonjs'}`],
    }, {
      check,
      filePath: String(args.path || ''),
      cwd: file.root,
      input: script.source,
      isCancelled: options.isCancelled,
      timeoutMs: remainingMs,
      startedAt,
    });
    if (!result.ok) return { ...result, error: `第 ${index + 1} 个内联脚本语法无效` };
  }
  return {
    ok: true,
    check,
    path: String(args.path || ''),
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    durationMs: Date.now() - startedAt,
    scriptsChecked: scripts.length,
    stdout: '',
    stderr: '',
  };
}

export const SAFE_CHECK_NAMES = Object.freeze(Object.keys(CHECKS));
