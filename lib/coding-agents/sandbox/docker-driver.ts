import path from 'node:path';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import {
  STUDIO_AGENT_IMAGE_CONTEXT,
  type StudioSandboxPolicy,
} from './policy';

const execFileAsync = promisify(execFile);

const AVAILABILITY_TTL_MS = 60_000;

let availabilityCache: { value: DockerAvailability; checkedAt: number } | null = null;

export interface DockerAvailability {
  available: boolean;
  version?: string;
  reason?: string;
}

/** 探测宿主 Docker 是否可用（带 60s 缓存） */
export async function getDockerAvailability(force = false): Promise<DockerAvailability> {
  const now = Date.now();
  if (!force && availabilityCache && now - availabilityCache.checkedAt < AVAILABILITY_TTL_MS) {
    return availabilityCache.value;
  }

  let result: DockerAvailability;
  try {
    const { stdout } = await execFileAsync('docker', ['info', '--format', '{{.ServerVersion}}'], {
      timeout: 5000,
      windowsHide: true,
    });
    const version = String(stdout || '').trim();
    result = version ? { available: true, version } : { available: false, reason: 'docker info 返回空版本' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    result = { available: false, reason: message };
  }

  availabilityCache = { value: result, checkedAt: now };
  return result;
}

/** 检查镜像是否存在；缺失时按需构建（STUDIO_AGENT_AUTO_BUILD=1） */
export async function ensureStudioAgentImage(policy: StudioSandboxPolicy): Promise<void> {
  try {
    await execFileAsync('docker', ['image', 'inspect', policy.image], {
      timeout: 10_000,
      windowsHide: true,
    });
    return;
  } catch {
    // not found, try build below
  }

  const autoBuild = String(process.env.STUDIO_AGENT_AUTO_BUILD || '0').trim() === '1';
  if (!autoBuild) {
    throw new Error(
      `沙箱镜像 ${policy.image} 不存在。请先在服务器上执行：\n` +
        `docker build -t ${policy.image} ${STUDIO_AGENT_IMAGE_CONTEXT}\n` +
        `或设置 STUDIO_AGENT_AUTO_BUILD=1 允许首次运行时自动构建。`
    );
  }

  await execFileAsync('docker', ['build', '-t', policy.image, STUDIO_AGENT_IMAGE_CONTEXT], {
    timeout: 10 * 60 * 1000,
    windowsHide: true,
    cwd: process.cwd(),
  });
}

/** 写入仅包含模型网关配置的环境变量文件（0600） */
export async function writeSandboxEnvFile(
  envFile: string,
  env: Record<string, string | undefined>
): Promise<void> {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    lines.push(`${key}=${value}`);
  }

  await mkdir(path.dirname(envFile), { recursive: true });
  await writeFile(envFile, `${lines.join('\n')}\n`, { encoding: 'utf-8', mode: 0o600 });
  await chmod(envFile, 0o600).catch(() => {});
}

/** 删除宿主上的沙箱密钥文件。该文件不挂载进容器，只供 docker run 读取。 */
export async function removeSandboxEnvFile(envFile: string | undefined): Promise<void> {
  if (!envFile) return;
  await rm(envFile, { force: true }).catch(() => {});
}

/** 启动容器，返回 docker CLI 子进程（args 由 buildDockerRunArgs 生成） */
export function spawnDocker(args: string[]): ChildProcess {
  return spawn('docker', args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

/** 强制销毁容器（killing docker CLI 并不会停止容器） */
export async function killStudioContainer(containerName: string): Promise<void> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(containerName)) return;
  await execFileAsync('docker', ['rm', '-f', containerName], {
    timeout: 15_000,
    windowsHide: true,
  }).catch(() => {});
}
