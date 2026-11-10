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
import { PI_CONFIG_SKILL_PREFIX } from './workspace-skills';

/** agentArgs 中代表会话文件的占位符，由启动器按运行环境替换成容器内/宿主路径 */
export const PI_SESSION_PLACEHOLDER = '__PI_SESSION_FILE__';

/** 容器内 pi 配置目录与审批扩展路径 */
const CONTAINER_CONFIG_DIR = '/pi-config';
const CONTAINER_SESSION_DIR = '/sessions';
const CONTAINER_APPROVAL_EXTENSION = '/opt/studio/approval.ts';
const CONTAINER_MODEL_NETWORK_EXTENSION = '/opt/pi/almaren-network/lib/coding-agents/extensions/model-network.ts';

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
  modelContextWindow?: number;
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

function writePiModelsConfig(workspaceDir: string, baseUrl: string, model: string, contextWindow?: number): string {
  const piConfigDir = path.join(path.dirname(workspaceDir), '.pi_agent');
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
            ...(contextWindow ? { contextWindow } : {}),
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

  const withPaths = (sessionPath: string, configDir: string, networkExtension: string, extensionPath?: string): string[] => {
    const args = options.agentArgs.map((arg) => {
      if (arg === PI_SESSION_PLACEHOLDER) return sessionPath;
      if (arg.startsWith(PI_CONFIG_SKILL_PREFIX)) {
        return path.join(configDir, 'skills', arg.slice(PI_CONFIG_SKILL_PREFIX.length)).replace(/\\/g, '/');
      }
      return arg;
    });
    args.push('--no-extensions', '--extension', networkExtension);
    if (extensionPath) args.push('--extension', extensionPath);
    return args;
  };

  if (mode !== 'host') {
    const availability = await getDockerAvailability();
    if (availability.available) {
      if (!apiKey) {
        throw new Error('Docker 沙箱执行 pi 需要模型 API Key，请先在账号设置中配置模型密钥');
      }

      const configDir = writePiModelsConfig(workspaceDir, baseUrl, model, options.modelContextWindow);
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
        ...modelProxyEnv(),
        ...(options.approvalMode ? { STUDIO_APPROVAL_MODE: options.approvalMode } : {}),
      });

      const agentArgs = withPaths(
        `${CONTAINER_SESSION_DIR}/${path.basename(sessionFile)}`,
        CONTAINER_CONFIG_DIR,
        CONTAINER_MODEL_NETWORK_EXTENSION,
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
  Object.assign(env, modelProxyEnv());
  if (options.approvalMode) {
    env.STUDIO_APPROVAL_MODE = options.approvalMode;
  }
  const configDir = path.join(path.dirname(workspaceDir), '.pi_agent');
  fs.mkdirSync(configDir, { recursive: true });
  env.PI_CODING_AGENT_DIR = configDir;
  if (apiKey) {
    writePiModelsConfig(workspaceDir, baseUrl, model, options.modelContextWindow);
    env.STUDIO_MODEL_API_KEY = apiKey;
  }
  fs.mkdirSync(sessionsDir, { recursive: true });

  const extensionPath = options.approvalMode
    ? path.resolve(process.cwd(), 'docker', 'studio-agent', 'extensions', 'approval.ts')
    : undefined;

  return {
    kind: 'host',
    command: process.execPath,
    args: [HOST_PI_CLI, ...withPaths(sessionFile, configDir,
      path.resolve(process.cwd(), 'lib/coding-agents/extensions/model-network.ts'), extensionPath)],
    env,
    cwd: workspaceDir,
    model,
  };
}

function modelProxyEnv(): Record<string, string> {
  return Object.fromEntries(
    ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy']
      .filter(key => process.env[key]).map(key => [key, process.env[key]!])
  );
}
