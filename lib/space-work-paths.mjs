import path from 'node:path';

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function safeSpaceWorkId(value) {
  const workId = String(value || '');
  if (!SAFE_ID_PATTERN.test(workId)) throw new Error('Work ID 格式不安全');
  return workId;
}

export function storedWorkspaceRelativePath(workId, logicalRelativePath) {
  const logical = String(logicalRelativePath || '').replaceAll('\\', '/').replace(/^workspace\//, '');
  return workId
    ? path.posix.join('workspace', 'works', safeSpaceWorkId(workId), logical)
    : path.posix.join('workspace', logical);
}

export function logicalWorkspaceRelativePath(workId, storedRelativePath) {
  const stored = String(storedRelativePath || '').replaceAll('\\', '/').replace(/^workspace\//, '');
  if (!workId) return stored;
  const prefix = `works/${safeSpaceWorkId(workId)}/`;
  if (!stored.startsWith(prefix)) throw new Error('文件不属于当前 Work');
  return stored.slice(prefix.length);
}
