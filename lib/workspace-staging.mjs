import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { lstatSync, rmSync } from 'node:fs';
import path from 'node:path';
import { gunzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_FILES = 1_000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_IMAGE_FILE_BYTES = 8 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const CHECKPOINT_FILE = '.execution-checkpoint.json.gz';
const MAX_CHECKPOINT_BYTES = 8 * 1024 * 1024;
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

function maxFileBytes(relativePath) {
  return IMAGE_EXTENSIONS.has(path.extname(relativePath).toLowerCase()) ? MAX_IMAGE_FILE_BYTES : MAX_FILE_BYTES;
}

function safeId(value, label) {
  const id = String(value || '');
  if (!SAFE_ID_PATTERN.test(id)) throw new Error(`${label}格式不安全`);
  return id;
}

function safeAttempt(value) {
  const attempt = Number(value);
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error('任务 attempt 格式不安全');
  return attempt;
}

function safeRelativePath(value) {
  const raw = String(value || '').trim().replaceAll('\\', '/');
  if (!raw || raw.startsWith('/') || raw.startsWith('~') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    throw new Error('只允许工作区相对路径');
  }
  const parts = raw.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('文件路径不安全');
  return parts.join('/');
}

function directories(options) {
  const userId = safeId(options.userId, '用户 ID');
  const spaceId = safeId(options.spaceId, '空间 ID');
  const workId = options.workId ? safeId(options.workId, 'Work ID') : null;
  const taskId = safeId(options.taskId, '任务 ID');
  const attempt = safeAttempt(options.attempt);
  const spacesRoot = path.resolve(options.projectRoot, 'data', 'spaces');
  const spaceRoot = path.join(spacesRoot, userId, spaceId);
  const workspaceBase = path.join(spaceRoot, 'workspace');
  const worksRoot = workId ? path.join(workspaceBase, 'works') : null;
  const workspaceRoot = workId ? path.join(worksRoot, workId) : workspaceBase;
  const stagingParent = path.join(spaceRoot, 'staging');
  const taskRoot = path.join(stagingParent, taskId);
  const attemptRoot = path.join(taskRoot, String(attempt));
  const stagingRoot = path.join(attemptRoot, 'workspace');
  return { spacesRoot, spaceRoot, workspaceBase, worksRoot, workspaceRoot, stagingParent, taskRoot, attemptRoot, stagingRoot };
}

async function assertDirectoryChain(paths) {
  for (const directory of paths) {
    try {
      if ((await lstat(directory)).isSymbolicLink()) throw new Error('工作区目录不允许符号链接');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await mkdir(directory);
      if ((await lstat(directory)).isSymbolicLink()) throw new Error('工作区目录不允许符号链接');
    }
  }
}

async function copyWorkspace(source, target) {
  let fileCount = 0;
  const visit = async (sourceDirectory, targetDirectory) => {
    await mkdir(targetDirectory, { recursive: true });
    const entries = await readdir(sourceDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const sourcePath = path.join(sourceDirectory, entry.name);
      const targetPath = path.join(targetDirectory, entry.name);
      const info = await lstat(sourcePath);
      if (info.isSymbolicLink()) throw new Error(`工作区不允许符号链接：${entry.name}`);
      if (info.isDirectory()) {
        await visit(sourcePath, targetPath);
      } else if (info.isFile()) {
        fileCount += 1;
        if (fileCount > MAX_FILES) throw new Error(`工作区文件超过 ${MAX_FILES} 个，无法创建安全暂存区`);
        if (info.size > maxFileBytes(sourcePath)) throw new Error(`工作区文件过大，无法创建安全暂存区：${entry.name}`);
        await copyFile(sourcePath, targetPath);
      }
    }
  };
  await visit(source, target);
}

export async function prepareWorkspaceAttempt(options, { sourceAttempt = null } = {}) {
  const resolved = directories(options);
  const userRoot = path.dirname(resolved.spaceRoot);
  await mkdir(resolved.spacesRoot, { recursive: true });
  await assertDirectoryChain([
    resolved.spacesRoot,
    userRoot,
    resolved.spaceRoot,
    resolved.workspaceBase,
    ...(resolved.worksRoot ? [resolved.worksRoot] : []),
    resolved.workspaceRoot,
    resolved.stagingParent,
    resolved.taskRoot,
    resolved.attemptRoot,
    resolved.stagingRoot,
  ]);
  const readyPath = path.join(resolved.attemptRoot, '.ready');
  try {
    if ((await stat(readyPath)).isFile()) return resolved;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await rm(resolved.attemptRoot, { recursive: true, force: true });
  await mkdir(resolved.stagingRoot, { recursive: true });
  let sourceRoot = resolved.workspaceRoot;
  if (sourceAttempt !== null) {
    const previous = directories({ ...options, attempt: sourceAttempt });
    if (safeAttempt(sourceAttempt) !== safeAttempt(options.attempt) - 1) {
      throw new Error('返工只能继承紧邻的上一次 attempt');
    }
    const sourceInfo = await lstat(previous.stagingRoot);
    if (sourceInfo.isSymbolicLink() || !sourceInfo.isDirectory()) {
      throw new Error('返工来源暂存区不安全');
    }
    const sourceReady = await stat(path.join(previous.attemptRoot, '.ready'));
    if (!sourceReady.isFile()) throw new Error('返工来源暂存区尚未准备完成');
    sourceRoot = previous.stagingRoot;
  }
  await copyWorkspace(sourceRoot, resolved.stagingRoot);
  await writeFile(readyPath, new Date().toISOString(), 'utf8');
  return resolved;
}

export async function cloneWorkspaceAttempt(sourceOptions, targetOptions) {
  const source = directories(sourceOptions);
  const target = directories(targetOptions);
  const sourceInfo = await lstat(source.stagingRoot);
  if (sourceInfo.isSymbolicLink() || !sourceInfo.isDirectory()) {
    throw new Error('重试来源暂存区不安全');
  }
  const sourceReady = await stat(path.join(source.attemptRoot, '.ready'));
  if (!sourceReady.isFile()) throw new Error('重试来源暂存区尚未准备完成');

  const userRoot = path.dirname(target.spaceRoot);
  await mkdir(target.spacesRoot, { recursive: true });
  await assertDirectoryChain([
    target.spacesRoot,
    userRoot,
    target.spaceRoot,
    target.workspaceBase,
    ...(target.worksRoot ? [target.worksRoot] : []),
    target.workspaceRoot,
    target.stagingParent,
    target.taskRoot,
  ]);
  await rm(target.attemptRoot, { recursive: true, force: true });
  await mkdir(target.stagingRoot, { recursive: true });
  await copyWorkspace(source.stagingRoot, target.stagingRoot);
  await writeFile(path.join(target.attemptRoot, '.ready'), new Date().toISOString(), 'utf8');
  return target;
}

export async function discardWorkspaceAttempt(options) {
  const { stagingParent, taskRoot, attemptRoot } = directories(options);
  for (const directory of [stagingParent, taskRoot]) {
    try {
      if ((await lstat(directory)).isSymbolicLink()) throw new Error('任务暂存目录不允许符号链接');
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
  await rm(attemptRoot, { recursive: true, force: true });
}

export function discardWorkspaceAttemptSync(options) {
  const { stagingParent, taskRoot, attemptRoot } = directories(options);
  for (const directory of [stagingParent, taskRoot]) {
    try {
      if (lstatSync(directory).isSymbolicLink()) throw new Error('任务暂存目录不允许符号链接');
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
  rmSync(attemptRoot, { recursive: true, force: true });
}

export function workspaceAttemptFile(options, logicalRelativePath) {
  const { stagingRoot } = directories(options);
  const logical = safeRelativePath(logicalRelativePath);
  const relativePath = logical.startsWith('workspace/') ? logical.slice('workspace/'.length) : logical;
  const target = path.resolve(stagingRoot, safeRelativePath(relativePath));
  if (!target.startsWith(stagingRoot + path.sep)) throw new Error('文件路径超出任务暂存区');
  return { root: stagingRoot, target };
}

export function workspaceAttemptRoot(options) {
  return directories(options).stagingRoot;
}

export async function saveExecutionCheckpoint(options, checkpoint) {
  const resolved = directories(options);
  const readyPath = path.join(resolved.attemptRoot, '.ready');
  const ready = await stat(readyPath);
  if (!ready.isFile()) throw new Error('任务暂存区尚未准备完成，无法保存执行检查点');
  const serialized = JSON.stringify(checkpoint);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CHECKPOINT_BYTES) {
    throw new Error(`执行检查点超过 ${MAX_CHECKPOINT_BYTES / 1024 / 1024}MB 安全上限`);
  }
  const target = path.join(resolved.attemptRoot, CHECKPOINT_FILE);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, await gzipAsync(serialized));
  await rename(temporary, target).catch(async (error) => {
    await rm(temporary, { force: true });
    throw error;
  });
  return { bytes: Buffer.byteLength(serialized, 'utf8') };
}

export async function readExecutionCheckpoint(options) {
  const target = path.join(directories(options).attemptRoot, CHECKPOINT_FILE);
  try {
    const compressed = await readFile(target);
    const serialized = await gunzipAsync(compressed);
    if (serialized.byteLength > MAX_CHECKPOINT_BYTES) throw new Error('执行检查点超过安全上限');
    const checkpoint = JSON.parse(serialized.toString('utf8'));
    if (!checkpoint || checkpoint.version !== 1 || !Array.isArray(checkpoint.conversation)) {
      throw new Error('执行检查点格式无效');
    }
    return checkpoint;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function fileSnapshot(target) {
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error('工作区文件不允许符号链接');
    if (!info.isFile()) return null;
    const sha256 = info.size <= maxFileBytes(target)
      ? createHash('sha256').update(await readFile(target)).digest('hex')
      : null;
    return { size: info.size, mtimeMs: info.mtimeMs, sha256 };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function assertNoSymlinkPath(root, relativePath) {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink()) throw new Error('工作区目录不允许符号链接');
  let current = root;
  for (const segment of safeRelativePath(relativePath).split('/')) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`工作区路径不允许符号链接：${relativePath}`);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
}

function matchesBaseline(expected, current) {
  if (!expected || !current) return expected === current;
  if (expected.sha256 && current.sha256) return expected.sha256 === current.sha256;
  return expected.size === current.size && expected.mtimeMs === current.mtimeMs;
}

async function rollbackAppliedEntries(resolved, baselineByPath, entries) {
  for (const entry of [...entries].reverse()) {
    const relativePath = safeRelativePath(entry.path);
    const target = path.join(resolved.workspaceRoot, relativePath);
    const expected = baselineByPath.get(relativePath);
    if (!expected) {
      await rm(target, { force: true });
      continue;
    }
    const backup = path.join(resolved.attemptRoot, 'rollback', relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(backup, target);
  }
}

export async function recoverWorkspaceAttemptApplication(options, baseline, entries) {
  const resolved = directories(options);
  const marker = path.join(resolved.attemptRoot, '.apply-ready');
  try {
    await stat(marker);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  const baselineByPath = new Map((baseline?.files || []).map((file) => [file.path, file]));
  await rollbackAppliedEntries(resolved, baselineByPath, Array.isArray(entries) ? entries : []);
  await rm(marker, { force: true });
  return true;
}

export async function applyWorkspaceAttempt(options, baseline, entries) {
  const resolved = directories(options);
  const baselineByPath = new Map((baseline?.files || []).map((file) => [file.path, file]));
  const changes = Array.isArray(entries) ? entries : [];
  await realpath(resolved.stagingRoot);

  for (const entry of changes) {
    const relativePath = safeRelativePath(entry.path);
    await assertNoSymlinkPath(resolved.workspaceRoot, relativePath);
    await assertNoSymlinkPath(resolved.stagingRoot, relativePath);
    const current = await fileSnapshot(path.join(resolved.workspaceRoot, relativePath));
    const expected = baselineByPath.get(relativePath) || null;
    if (!matchesBaseline(expected, current)) {
      const error = new Error(`正式工作区文件已变化，无法覆盖：${relativePath}`);
      error.code = 'WORKSPACE_CONFLICT';
      throw error;
    }
    if (entry.change !== 'DELETED') {
      const staged = await fileSnapshot(path.join(resolved.stagingRoot, relativePath));
      if (!staged) throw new Error(`暂存产物不存在：${relativePath}`);
    }
  }

  const rollbackRoot = path.join(resolved.attemptRoot, 'rollback');
  await rm(rollbackRoot, { recursive: true, force: true });
  for (const entry of changes) {
    const relativePath = safeRelativePath(entry.path);
    if (!baselineByPath.has(relativePath)) continue;
    const backup = path.join(rollbackRoot, relativePath);
    await mkdir(path.dirname(backup), { recursive: true });
    await copyFile(path.join(resolved.workspaceRoot, relativePath), backup);
  }
  const applyMarker = path.join(resolved.attemptRoot, '.apply-ready');
  await writeFile(applyMarker, new Date().toISOString(), 'utf8');

  const applied = [];
  try {
    for (const entry of changes) {
      const relativePath = safeRelativePath(entry.path);
      const target = path.join(resolved.workspaceRoot, relativePath);
      applied.push(entry);
      if (entry.change === 'DELETED') {
        await rm(target, { force: true });
      } else {
        await mkdir(path.dirname(target), { recursive: true });
        const temporary = `${target}.${randomUUID()}.tmp`;
        await copyFile(path.join(resolved.stagingRoot, relativePath), temporary);
        await rm(target, { force: true });
        await rename(temporary, target).catch(async (error) => {
          await rm(temporary, { force: true });
          throw error;
        });
      }
    }
  } catch (error) {
    await rollbackAppliedEntries(resolved, baselineByPath, applied);
    await rm(applyMarker, { force: true });
    throw error;
  }
  return {
    rollback: async () => {
      await rollbackAppliedEntries(resolved, baselineByPath, changes);
      await rm(applyMarker, { force: true });
    },
  };
}
