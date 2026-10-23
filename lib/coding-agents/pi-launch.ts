import path from 'node:path';
import fs from 'node:fs';
import { buildSanitizedEnv } from './sandbox';
import { buildDockerRunArgs } from './sandbox/docker-args';
import {
  ensureStudioAgentImage,
  getDockerAvailability,
  writeSandboxEnvFile,
} from './sandbox/docker-driver';
import { buildStudioSandboxPolicy, resolveSandboxMode } from './sandbox/policy';
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from '../core/model-client';

/** agentArgs 中代表会话文件的占位符，由启动器按运行环境替换成容器内/宿主路径 */
export const PI_SESSION_PLACEHOLDER = '__PI_SESSION_FILE__';

/** 容器内 pi 配置目录与审批扩展路径 */
const CONTAINER_CONFIG_DIR = '/pi-config';
const CONTAINER_SESSION_DIR = '/sessions';
const CONTAINER_APPROVAL_EXTENSION = '/opt/studio/approval.ts';

const HOST_PI_CLI = path.resolve(
  process.cwd(),
  'node_modules',
  '@earendil-works',
  'pi-coding-agent',
  'dist',
  'bundle',
  'cli.js'
);

export interface PiLaunchOptions {
  /** 安全的会话 ID，用于容器命名 */
  sessionId: string;
  userId: string;
  workspaceDir: string;
  /** pi CLI 参数（不含 cli.js 入口），可用占位符指定会话文件 */
  agentArgs: string[];
  customApiKey?: string;
  customBaseUrl?: string;
  modelName?: string;
  /** 传入后启用工具审批扩展，值为 never / dangerous / always */
  approvalMode?: string;
}

export type PiLaunchSpec =
  | {
      kind: 'docker';
      command: 'docker';
      args: string[];
      containerName: string;
      envFile: string;
      model: string;
    }
  | {
      kind: 'host';
      command: string;
      args: string[];
      env: Record<string, string | undefined>;
      cwd: string;
      model: string;
    };

function writePiModelsConfig(userId: string, baseUrl: string, apiKey: string, model: string): string {
  const piConfigDir = path.resolve(process.cwd(), 'data', 'studio', userId, '.pi_agent');
  fs.mkdirSync(piConfigDir, { recursive: true });
  const modelsConfig = {
    providers: {
      custom: {
        baseUrl,
        api: 'openai-completions',
        // 解析时从进程环境读取，避免把真实密钥写进挂载到沙箱的文件。
        apiKey: '$STUDIO_MODEL_API_KEY',
        models: [
          {
            id: model,
            name: model,
            reasoning: true,
            input: ['text'],
          },
        ],
      },
    },
  };
  fs.writeFileSync(
    path.join(piConfigDir, 'models.json'),
    JSON.stringify(modelsConfig, null, 2),
    'utf-8'
  );
  return piConfigDir;
}

/**
 * 解析 pi 的启动方式：优先 Docker 沙箱，Docker 不可用时按 STUDIO_SANDBOX_MODE 决定回退或失败。
 */
export async function buildPiLaunchSpec(options: PiLaunchOptions): Promise<PiLaunchSpec> {
  const workspaceDir = path.resolve(options.workspaceDir);
  const sessionsDir = path.join(path.dirname(workspaceDir), 'sessions');
  const sessionFile = path.join(sessionsDir, `${options.sessionId}.jsonl`);
  const model = options.modelName || DEFAULT_MODEL;
  const apiKey = String(options.customApiKey || process.env.apiKey || process.env.OPENAI_API_KEY || '').trim();
  const baseUrl = String(options.customBaseUrl || DEFAULT_BASE_URL).trim();
  const mode = resolveSandboxMode();

  const withPaths = (sessionPath: string, extensionPath?: string): string[] => {
    const args = options.agentArgs.map((arg) => (arg === PI_SESSION_PLACEHOLDER ? sessionPath : arg));
    if (extensionPath) {
      args.push('--no-extensions', '--extension', extensionPath);
    }
    return args;
  };

  if (mode !== 'host') {
    const availability = await getDockerAvailability();
    if (availability.available) {
      if (!apiKey) {
        throw new Error('Docker 沙箱执行 pi 需要模型 API Key，请先在账号设置中配置模型密钥');
      }

      const configDir = writePiModelsConfig(options.userId, baseUrl, apiKey, model);
      fs.mkdirSync(sessionsDir, { recursive: true });

      const policy = buildStudioSandboxPolicy({
        sessionId: options.sessionId,
        workspaceDir,
        configDir,
        sessionsDir,
        // env-file 由 Docker 在宿主侧读取，不能放在会挂载到容器的目录中。
        envFile: path.join(path.dirname(workspaceDir), `.sandbox-${options.sessionId}.env`),
      });

      await ensureStudioAgentImage(policy);
      await writeSandboxEnvFile(policy.envFile, {
        STUDIO_MODEL_API_KEY: apiKey,
        ...(options.approvalMode ? { STUDIO_APPROVAL_MODE: options.approvalMode } : {}),
      });

      const agentArgs = withPaths(
        `${CONTAINER_SESSION_DIR}/${path.basename(sessionFile)}`,
        options.approvalMode ? CONTAINER_APPROVAL_EXTENSION : undefined
      );

      return {
        kind: 'docker',
        command: 'docker',
        args: buildDockerRunArgs(policy, agentArgs),
        containerName: policy.containerName,
        envFile: policy.envFile,
        model,
      };
    }

    if (mode === 'docker') {
      throw new Error(
        `STUDIO_SANDBOX_MODE=docker，但宿主 Docker 不可用：${availability.reason || 'unknown'}`
      );
    }
  }

  const env = buildSanitizedEnv({
    agentId: 'pi',
    customApiKey: apiKey || undefined,
    customBaseUrl: options.customBaseUrl,
  });
  if (options.approvalMode) {
    env.STUDIO_APPROVAL_MODE = options.approvalMode;
  }
  if (apiKey) {
    env.PI_CODING_AGENT_DIR = writePiModelsConfig(options.userId, baseUrl, apiKey, model);
    env.STUDIO_MODEL_API_KEY = apiKey;
  }
  fs.mkdirSync(sessionsDir, { recursive: true });

  const extensionPath = options.approvalMode
    ? path.resolve(process.cwd(), 'docker', 'studio-agent', 'extensions', 'approval.ts')
    : undefined;

  return {
    kind: 'host',
    command: process.execPath,
    args: [HOST_PI_CLI, ...withPaths(sessionFile, extensionPath)],
    env,
    cwd: workspaceDir,
    model,
  };
}
