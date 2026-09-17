import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { CODING_AGENTS_REGISTRY, SUPPORTED_AGENT_IDS } from './registry';
import { CodingAgentId, CodingAgentStatusInfo } from './types';
import { windowsCmdShimExecution, windowsCommandNeedsShell } from './windows-compat';

const execFileAsync = promisify(execFile);

interface CacheEntry {
  info: CodingAgentStatusInfo;
  expiresAt: number;
}

const statusCache = new Map<CodingAgentId, CacheEntry>();
const CACHE_TTL_MS = 30_000;

async function detectBuiltinPi(): Promise<{ version: string | null; path: string | null }> {
  try {
    const pkgPath = path.resolve(process.cwd(), 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json');
    const content = await readFile(pkgPath, 'utf-8');
    const parsed = JSON.parse(content);
    return {
      version: parsed.version || '0.85.1',
      path: pkgPath,
    };
  } catch {
    return {
      version: '0.85.1',
      path: 'node_modules/@earendil-works/pi-coding-agent',
    };
  }
}

async function detectCliAgent(agentId: CodingAgentId): Promise<{ installed: boolean; version: string | null; path: string | null }> {
  const meta = CODING_AGENTS_REGISTRY[agentId];
  if (!meta) return { installed: false, version: null, path: null };

  const isWin = process.platform === 'win32';
  const command = meta.command;

  try {
    let cmdToRun = command;
    let argsToRun = meta.versionArgs;
    let options: Record<string, unknown> = { timeout: 3000 };

    if (isWin) {
      const shim = windowsCmdShimExecution(cmdToRun, argsToRun);
      cmdToRun = shim.command;
      argsToRun = shim.args;
      options.windowsVerbatimArguments = true;
    }

    const { stdout, stderr } = await execFileAsync(cmdToRun, argsToRun, options);
    const output = (stdout || stderr || '').trim();
    // Parse version number like v0.2.14 or 1.0.0
    const versionMatch = output.match(/(\d+\.\d+\.\d+[\w.-]*)/);
    return {
      installed: true,
      version: versionMatch ? versionMatch[1] : output.slice(0, 30),
      path: command,
    };
  } catch {
    return {
      installed: false,
      version: null,
      path: null,
    };
  }
}

export async function checkAgentStatus(agentId: CodingAgentId, forceRefresh = false): Promise<CodingAgentStatusInfo> {
  const now = Date.now();
  if (!forceRefresh) {
    const cached = statusCache.get(agentId);
    if (cached && cached.expiresAt > now) {
      return cached.info;
    }
  }

  const meta = CODING_AGENTS_REGISTRY[agentId];
  if (!meta) {
    throw new Error(`未知的 Coding Agent: ${agentId}`);
  }

  let statusInfo: CodingAgentStatusInfo;

  if (meta.isBuiltin) {
    const { version, path: piPath } = await detectBuiltinPi();
    statusInfo = {
      ...meta,
      status: 'installed',
      version,
      path: piPath,
      lastCheckedAt: now,
    };
  } else {
    const { installed, version, path: cliPath } = await detectCliAgent(agentId);
    statusInfo = {
      ...meta,
      status: installed ? 'installed' : 'not_installed',
      version,
      path: cliPath,
      lastCheckedAt: now,
    };
  }

  statusCache.set(agentId, {
    info: statusInfo,
    expiresAt: now + CACHE_TTL_MS,
  });

  return statusInfo;
}

export async function checkAllAgentsStatus(forceRefresh = false): Promise<CodingAgentStatusInfo[]> {
  return Promise.all(SUPPORTED_AGENT_IDS.map((id) => checkAgentStatus(id, forceRefresh)));
}
