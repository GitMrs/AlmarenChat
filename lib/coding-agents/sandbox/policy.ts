import path from 'node:path';

export type StudioSandboxMode = 'auto' | 'docker' | 'host';

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/**
 * 沙箱运行模式：
 * - auto（默认）：检测到 Docker 就走容器，否则维持原有宿主执行
 * - docker：强制容器，Docker 不可用时直接失败，绝不静默回退宿主
 * - host：始终在宿主执行（本地开发用）
 */
export function resolveSandboxMode(): StudioSandboxMode {
  const raw = String(process.env.STUDIO_SANDBOX_MODE || 'auto').trim().toLowerCase();
  if (raw === 'docker' || raw === 'host' || raw === 'auto') return raw;
  return 'auto';
}

export function resolveStudioAgentImage(): string {
  return String(process.env.STUDIO_AGENT_IMAGE || 'almaren/studio-agent:0.1.0').trim();
}

/** 镜像构建上下文（相对项目根目录） */
export const STUDIO_AGENT_IMAGE_CONTEXT = path.join('docker', 'studio-agent');

export interface StudioSandboxPolicy {
  image: string;
  containerName: string;
  /** 宿主上的用户工作区绝对路径，挂载到 /workspace */
  workspaceDir: string;
  /** 宿主上的 pi 配置目录绝对路径，挂载到 /pi-config */
  configDir: string;
  /** 宿主上的容器内会话/临时目录绝对路径，挂载到 /sessions */
  sessionsDir: string;
  /** 环境变量文件绝对路径（仅含模型网关 key / baseUrl） */
  envFile: string;
  uid: number;
  gid: number;
  memoryLimitMb: number;
  cpus: string;
  pidsLimit: number;
  network: string;
}

export interface BuildStudioSandboxPolicyInput {
  sessionId: string;
  workspaceDir: string;
  configDir: string;
  sessionsDir: string;
  envFile: string;
}

const SAFE_SESSION_ID = /^[a-zA-Z0-9_-]+$/;

export function buildStudioSandboxPolicy(
  input: BuildStudioSandboxPolicyInput
): StudioSandboxPolicy {
  if (!SAFE_SESSION_ID.test(input.sessionId)) {
    throw new Error('会话 ID 格式不安全，拒绝创建容器');
  }

  for (const [label, value] of [
    ['workspaceDir', input.workspaceDir],
    ['configDir', input.configDir],
    ['sessionsDir', input.sessionsDir],
    ['envFile', input.envFile],
  ] as const) {
    if (!path.isAbsolute(value)) {
      throw new Error(`沙箱挂载路径必须是绝对路径: ${label}=${value}`);
    }
  }

  // 运行期以宿主进程的 uid/gid 运行容器，避免挂载目录出现权限不一致。
  const getuid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  const getgid = typeof process.getgid === 'function' ? process.getgid() : undefined;

  return {
    image: resolveStudioAgentImage(),
    containerName: `almaren-studio-${input.sessionId}`,
    workspaceDir: input.workspaceDir,
    configDir: input.configDir,
    sessionsDir: input.sessionsDir,
    envFile: input.envFile,
    uid: typeof getuid === 'number' ? getuid : 1000,
    gid: typeof getgid === 'number' ? getgid : 1000,
    memoryLimitMb: readIntEnv('STUDIO_SANDBOX_MEMORY_MB', 2048, 256, 16384),
    cpus: String(process.env.STUDIO_SANDBOX_CPUS || '2'),
    pidsLimit: readIntEnv('STUDIO_SANDBOX_PIDS', 256, 64, 4096),
    network: String(process.env.STUDIO_SANDBOX_NETWORK || 'bridge'),
  };
}
