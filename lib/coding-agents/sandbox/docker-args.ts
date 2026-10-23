import type { StudioSandboxPolicy } from './policy';

/**
 * 将沙箱策略翻译成 `docker run` 参数。
 *
 * 安全基线：
 * - no-new-privileges + cap-drop ALL：容器内无法提权
 * - --read-only + 只读 tmpfs /tmp：根文件系统不可写
 * - 只挂载 workspace(RW)、pi-config(RW)、sessions(RW)
 * - --env-file 注入模型网关密钥，避免出现在进程 argv 中
 * - pids / memory / cpu 限制，防止 fork 炸弹与资源占用
 */
export function buildDockerRunArgs(
  policy: StudioSandboxPolicy,
  agentArgs: string[]
): string[] {
  return [
    'run',
    '-i',
    '--rm',
    '--init',
    '--name',
    policy.containerName,
    '--security-opt',
    'no-new-privileges:true',
    '--cap-drop',
    'ALL',
    '--pids-limit',
    String(policy.pidsLimit),
    '--memory',
    `${policy.memoryLimitMb}m`,
    '--cpus',
    policy.cpus,
    '--read-only',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=512m',
    '--user',
    `${policy.uid}:${policy.gid}`,
    '--workdir',
    '/workspace',
    '--network',
    policy.network,
    '--env-file',
    policy.envFile,
    '-e',
    'HOME=/tmp',
    '-e',
    'NODE_ENV=production',
    '-e',
    'PI_CODING_AGENT_DIR=/pi-config',
    '-v',
    `${policy.workspaceDir}:/workspace:rw`,
    '-v',
    `${policy.configDir}:/pi-config:rw`,
    '-v',
    `${policy.sessionsDir}:/sessions:rw`,
    policy.image,
    ...agentArgs,
  ];
}
