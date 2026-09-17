import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export async function resolveUserWorkspace(
  projectRoot: string,
  userId: string,
  spaceId: string = 'default'
): Promise<string> {
  const safeUserId = String(userId || '').trim();
  const safeSpaceId = String(spaceId || 'default').trim();

  if (!SAFE_ID_PATTERN.test(safeUserId)) {
    throw new Error('用户 ID 格式不安全，拒绝访问工作区');
  }
  if (!SAFE_ID_PATTERN.test(safeSpaceId)) {
    throw new Error('空间 ID 格式不安全，拒绝访问工作区');
  }

  const spacesRoot = path.resolve(projectRoot, 'data', 'spaces');
  const userWorkspace = path.join(spacesRoot, safeUserId, safeSpaceId, 'workspace');

  // Verify canonical path does not escape spacesRoot
  const normalizedSpacesRoot = path.normalize(spacesRoot);
  const normalizedWorkspace = path.normalize(userWorkspace);
  if (!normalizedWorkspace.startsWith(normalizedSpacesRoot)) {
    throw new Error('路径安全校验失败：禁止工作区路径逃逸');
  }

  // Ensure workspace directory exists
  await mkdir(userWorkspace, { recursive: true });
  return userWorkspace;
}

export async function resolveStudioWorkspace(
  projectRoot: string,
  userId: string,
  workspaceId: string = 'default'
): Promise<string> {
  const safeUserId = String(userId || '').trim();
  const safeWorkspaceId = String(workspaceId || 'default').trim();

  if (!SAFE_ID_PATTERN.test(safeUserId)) {
    throw new Error('用户 ID 格式不安全，拒绝访问工作区');
  }
  if (!SAFE_ID_PATTERN.test(safeWorkspaceId)) {
    throw new Error('工作区 ID 格式不安全，拒绝访问工作区');
  }

  const studioRoot = path.resolve(projectRoot, 'data', 'studio');
  const userWorkspace = path.join(studioRoot, safeUserId, safeWorkspaceId, 'workspace');

  const normalizedStudioRoot = path.normalize(studioRoot);
  const normalizedWorkspace = path.normalize(userWorkspace);
  if (!normalizedWorkspace.startsWith(normalizedStudioRoot)) {
    throw new Error('路径安全校验失败：禁止工作区路径逃逸');
  }

  await mkdir(userWorkspace, { recursive: true });
  return userWorkspace;
}

export async function deleteStudioWorkspaceFolder(
  projectRoot: string,
  userId: string,
  workspaceId: string
): Promise<void> {
  const safeUserId = String(userId || '').trim();
  const safeWorkspaceId = String(workspaceId || '').trim();

  if (!SAFE_ID_PATTERN.test(safeUserId) || !SAFE_ID_PATTERN.test(safeWorkspaceId)) {
    return;
  }

  const studioRoot = path.resolve(projectRoot, 'data', 'studio');
  const targetDir = path.join(studioRoot, safeUserId, safeWorkspaceId);

  const normalizedStudioRoot = path.normalize(studioRoot);
  const normalizedTargetDir = path.normalize(targetDir);
  if (!normalizedTargetDir.startsWith(normalizedStudioRoot)) {
    return;
  }

  await rm(targetDir, { recursive: true, force: true }).catch(() => {});
}


export interface SanitizedEnvOptions {
  customApiKey?: string;
  customBaseUrl?: string;
  agentId: string;
}

/**
 * Builds a strict whitelist-based environment dictionary for spawned subprocesses.
 * Strips out critical server credentials (DATABASE_URL, JWT_SECRET, etc.).
 */
export function buildSanitizedEnv(options: SanitizedEnvOptions): Record<string, string | undefined> {
  const allowedKeys = [
    'PATH',
    'Path',
    'SYSTEMROOT',
    'SystemRoot',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'HOME',
    'HOMEPATH',
    'HOMEDRIVE',
    'LANG',
    'LC_ALL',
    'COMSPEC',
    'NODE_PATH',
  ];

  const env: Record<string, string | undefined> = {
    NODE_ENV: 'production',
    PYTHONIOENCODING: 'utf-8',
  };

  for (const key of allowedKeys) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }

  // Inject agent-specific keys if provided
  if (options.customApiKey) {
    const key = options.customApiKey.trim();
    if (options.agentId === 'claude-code') {
      env.ANTHROPIC_API_KEY = key;
    } else if (options.agentId === 'codex') {
      env.OPENAI_API_KEY = key;
    } else if (options.agentId === 'dsh') {
      env.DEEPSEEK_API_KEY = key;
    } else if (options.agentId === 'grok') {
      env.XAI_API_KEY = key;
    } else if (options.agentId === 'pi') {
      env.DEEPSEEK_API_KEY = key;
      env.OPENAI_API_KEY = key;
      env.ANTHROPIC_API_KEY = key;
      env.GEMINI_API_KEY = key;
    }
    env.API_KEY = key;
  }

  if (options.customBaseUrl) {
    env.OPENAI_BASE_URL = options.customBaseUrl;
    env.ANTHROPIC_BASE_URL = options.customBaseUrl;
  }

  return env;
}
