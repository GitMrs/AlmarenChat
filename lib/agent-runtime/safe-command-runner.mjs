import { spawn } from 'node:child_process';
import path from 'node:path';
import { workspaceAttemptFile } from '../workspace-staging.mjs';

const MAX_OUTPUT_CHARS = 12_000;
const DEFAULT_TIMEOUT_MS = 20_000;
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
};

function boundedOutput(value) {
  const text = String(value || '');
  return text.length <= MAX_OUTPUT_CHARS ? text : `${text.slice(0, MAX_OUTPUT_CHARS)}\n[输出已截断]`;
}

export async function runSafeWorkspaceCheck(options, args = {}) {
  if (!options.taskId || !options.attempt) throw new Error('安全检查只能在任务暂存区执行');
  const check = String(args.check || '');
  const policy = CHECKS[check];
  if (!policy) throw new Error('不支持的安全检查类型');
  const file = workspaceAttemptFile(options, args.path);
  const extension = path.extname(file.target).toLowerCase();
  if (!policy.extensions.has(extension)) throw new Error(`当前检查不支持 ${extension || '无扩展名'} 文件`);
  const command = policy.command(options.projectRoot, file.target);
  const timeoutMs = Math.min(30_000, Math.max(1_000, Number(options.commandTimeoutMs || DEFAULT_TIMEOUT_MS)));
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd: file.root,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
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
      path: String(args.path || ''),
      exitCode,
      signal,
      timedOut,
      cancelled,
      durationMs: Date.now() - startedAt,
      stdout: boundedOutput(stdout),
      stderr: boundedOutput(stderr),
    }));
    const stop = () => child.kill('SIGKILL');
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    timeout.unref?.();
    const cancellationPoll = setInterval(() => {
      if (!options.isCancelled?.()) return;
      cancelled = true;
      stop();
    }, 100);
    cancellationPoll.unref?.();
  });
}

export const SAFE_CHECK_NAMES = Object.freeze(Object.keys(CHECKS));
