import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolveStudioWorkspace } from './sandbox';
import { buildPiLaunchSpec, PI_SESSION_PLACEHOLDER, type PiLaunchSpec } from './pi-launch';
import { killStudioContainer, removeSandboxEnvFile, spawnDocker } from './sandbox/docker-driver';
import { DEFAULT_MODEL } from '../core/model-client';
import {
  approvalStore,
  type ApprovalDecision,
  type StudioApprovalMode,
} from './approval-store';
import { redactSecrets } from './secret-redaction';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const TURN_TIMEOUT_MS = 10 * 60 * 1000;
const ABORT_GRACE_MS = 15 * 1000;
const MAX_RESULT_CHARS = 4000;

const DANGEROUS_TOOLS = new Set(['write', 'edit', 'bash', 'patch', 'shell']);

export interface StudioRunEvent {
  type: string;
  data?: any;
}

export interface StudioPiTurnOptions {
  userId: string;
  runId: string;
  approvalMode?: StudioApprovalMode;
  workspaceId: string;
  workspaceSystemPrompt?: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  reasoningEffort?: string;
  modelName?: string;
  modelContextWindow?: number;
  apiBaseUrl?: string;
  apiKey?: string;
  signal?: AbortSignal;
  /** 客户端处于全新对话（history 为空）时，丢弃旧的 pi 会话 */
  resetSession?: boolean;
  onEvent: (event: StudioRunEvent) => void;
}

interface ToolInfo {
  toolCallId: string;
  toolName: string;
  args: Record<string, any>;
}

interface TurnState {
  options: StudioPiTurnOptions;
  resolve: () => void;
  reject: (err: Error) => void;
  settled: boolean;
  pendingApprovals: ToolInfo[];
  deniedTools: Set<string>;
  timer?: NodeJS.Timeout;
  abortGraceTimer?: NodeJS.Timeout;
  detachAbort?: () => void;
}

interface RuntimeEntry {
  key: string;
  child: ChildProcess;
  containerName?: string;
  envFile?: string;
  buffer: string;
  turn: TurnState | null;
  idleTimer?: NodeJS.Timeout;
  stopping: boolean;
  model: string;
  systemPrompt?: string;
}

function requiresApproval(toolName: string, mode: StudioApprovalMode): boolean {
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  return DANGEROUS_TOOLS.has(String(toolName || ''));
}

function mapToolName(toolName: string): string {
  const name = String(toolName || '').toLowerCase();
  if (name === 'write' || name === 'edit' || name === 'patch' || name === 'write_file' || name === 'edit_file') {
    return 'write';
  }
  if (name === 'bash' || name === 'shell' || name === 'run_command') return 'bash';
  if (name === 'read' || name === 'read_file') return 'read';
  return name || 'tool';
}

function buildToolPreview(toolName: string, args: Record<string, any>): string {
  const input = args || {};
  const candidates = [input.path, input.file_path, input.command, input.pattern, input.query];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().slice(0, 300);
    }
  }
  return mapToolName(toolName);
}

function stringifyResult(result: any): string {
  if (result == null) return '';
  if (typeof result === 'string') return result.slice(0, MAX_RESULT_CHARS);
  if (Array.isArray(result.content)) {
    const text = result.content
      .filter((block: any) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text)
      .join('\n');
    if (text) return text.slice(0, MAX_RESULT_CHARS);
  }
  try {
    return JSON.stringify(result).slice(0, MAX_RESULT_CHARS);
  } catch {
    return String(result).slice(0, MAX_RESULT_CHARS);
  }
}

function stableSessionId(userId: string, workspaceId: string): string {
  return `${userId}-${workspaceId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

function thinkingLevelForReasoningEffort(value?: string): string {
  switch (String(value || '').toLowerCase()) {
    case 'none':
      return 'off';
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'xhigh':
      return 'xhigh';
    case 'max':
      return 'max';
    default:
      return 'high';
  }
}

async function seedSessionFile(
  sessionFile: string,
  workspaceDir: string,
  model: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<void> {
  if (history.length === 0) return;
  await mkdir(path.dirname(sessionFile), { recursive: true });

  const sessionId = randomUUID();
  const now = new Date().toISOString();
  const entries: any[] = [
    { type: 'session', version: 3, id: sessionId, timestamp: now, cwd: workspaceDir },
    {
      type: 'model_change',
      id: randomUUID(),
      parentId: null,
      timestamp: now,
      provider: 'custom',
      modelId: model,
    },
    {
      type: 'thinking_level_change',
      id: randomUUID(),
      parentId: null,
      timestamp: now,
      thinkingLevel: 'high',
    },
  ];
  let parentId = entries[2].id;
  for (const item of history) {
    const id = randomUUID();
    entries.push({
      type: 'message',
      id,
      parentId,
      timestamp: Date.now(),
      message:
        item.role === 'user'
          ? { role: 'user', content: [{ type: 'text', text: item.content }], timestamp: Date.now() }
          : {
              role: 'assistant',
              content: [{ type: 'text', text: item.content }],
              api: 'openai-completions',
              provider: 'custom',
              model,
              usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
              stopReason: 'stop',
              timestamp: Date.now(),
            },
    });
    parentId = id;
  }

  try {
    await writeFile(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, {
      encoding: 'utf-8',
      flag: 'wx',
    });
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
  }
}

export class PiStudioRuntime {
  private runtimes = new Map<string, RuntimeEntry>();

  async runTurn(options: StudioPiTurnOptions): Promise<void> {
    const key = `${options.userId}:${options.workspaceId}`;
    if (options.resetSession) {
      await this.resetSession(key, options);
    }
    const entry = await this.acquireRuntime(key, options);
    if (entry.turn) {
      throw new Error('当前工作区上一条消息仍在执行，请稍候再试');
    }

    return new Promise<void>((resolve, reject) => {
      const turn: TurnState = {
        options,
        resolve,
        reject,
        settled: false,
        pendingApprovals: [],
        deniedTools: new Set(),
      };
      entry.turn = turn;
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
        entry.idleTimer = undefined;
      }

      turn.timer = setTimeout(() => {
        this.failTurn(entry, new Error('pi 会话执行超时（10 分钟）'));
        this.stopRuntime(key).catch(() => {});
      }, TURN_TIMEOUT_MS);
      turn.timer.unref?.();

      const onAbort = () => {
        this.send(entry, { type: 'abort' });
        turn.abortGraceTimer = setTimeout(() => {
          this.failTurn(entry, new Error('会话已取消'));
          this.stopRuntime(key).catch(() => {});
        }, ABORT_GRACE_MS);
        turn.abortGraceTimer.unref?.();
      };
      if (options.signal) {
        if (options.signal.aborted) onAbort();
        else {
          options.signal.addEventListener('abort', onAbort);
          turn.detachAbort = () => options.signal?.removeEventListener('abort', onAbort);
        }
      }

      options.onEvent({ type: 'run.started', data: { runId: options.runId } });
      this.send(entry, {
        type: 'set_thinking_level',
        level: thinkingLevelForReasoningEffort(options.reasoningEffort),
      });
      this.send(entry, { type: 'prompt', message: options.message });
    });
  }

  /**
   * 向正在执行的任务补充用户消息。
   * - steer：当前助手回合执行完工具后、下一次 LLM 调用前插话（即时纠偏）
   * - followUp：等 agent 全部结束后再处理（追加任务）
   * 无进行中的回合时返回 accepted=false，由调用方回退为普通新请求。
   */
  async submitUserMessage(params: {
    userId: string;
    workspaceId: string;
    message: string;
    mode: 'steer' | 'followUp';
  }): Promise<{ accepted: boolean; reason?: string }> {
    const key = `${params.userId}:${params.workspaceId}`;
    const entry = this.runtimes.get(key);
    const turn = entry?.turn;
    if (!entry || !turn || turn.settled) {
      return { accepted: false, reason: '当前工作区没有正在执行的任务' };
    }

    turn.options.onEvent({
      type: 'user.message_injected',
      data: { message: params.message, mode: params.mode },
    });
    this.send(entry, {
      type: params.mode === 'steer' ? 'steer' : 'follow_up',
      message: params.message,
    });
    return { accepted: true };
  }

  /** 丢弃工作区常驻进程与会话文件，开启全新上下文 */
  private async resetSession(key: string, options: StudioPiTurnOptions): Promise<void> {
    await this.stopRuntime(key);
    const workspaceDir = await resolveStudioWorkspace(process.cwd(), options.userId, options.workspaceId);
    const sessionFile = path.join(
      path.dirname(workspaceDir),
      'sessions',
      `${stableSessionId(options.userId, options.workspaceId)}.jsonl`
    );
    await rm(sessionFile, { force: true }).catch(() => {});
  }

  /** 结束某个工作区的常驻进程（删除工作区/服务关闭时调用） */
  async stopRuntime(key: string): Promise<void> {
    const entry = this.runtimes.get(key);
    if (!entry) return;
    entry.stopping = true;
    this.runtimes.delete(key);
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    if (entry.containerName) {
      await killStudioContainer(entry.containerName);
    }
    await removeSandboxEnvFile(entry.envFile);
    entry.child.stdin?.end();
    entry.child.kill('SIGTERM');
    setTimeout(() => {
      if (entry.child.exitCode === null) entry.child.kill('SIGKILL');
    }, 3000).unref?.();
  }

  private async acquireRuntime(key: string, options: StudioPiTurnOptions): Promise<RuntimeEntry> {
    const model = options.modelName || DEFAULT_MODEL;
    const existing = this.runtimes.get(key);
    if (
      existing &&
      !existing.stopping &&
      existing.child.exitCode === null &&
      existing.model === model &&
      existing.systemPrompt === options.workspaceSystemPrompt
    ) {
      return existing;
    }
    if (existing) {
      await this.stopRuntime(key);
    }

    const workspaceDir = await resolveStudioWorkspace(process.cwd(), options.userId, options.workspaceId);
    const sessionId = stableSessionId(options.userId, options.workspaceId);
    const sessionFile = path.join(path.dirname(workspaceDir), 'sessions', `${sessionId}.jsonl`);
    await seedSessionFile(sessionFile, workspaceDir, model, options.history || []);

    const agentArgs = [
      '--mode',
      'rpc',
      '--provider',
      'custom',
      '--model',
      model,
      '--session',
      PI_SESSION_PLACEHOLDER,
      '--no-skills',
      '--no-prompt-templates',
      '--no-context-files',
    ];

    if (options.workspaceSystemPrompt) {
      agentArgs.push('--append-system-prompt', options.workspaceSystemPrompt);
    }

    const launch: PiLaunchSpec = await buildPiLaunchSpec({
      sessionId,
      userId: options.userId,
      workspaceDir,
      agentArgs,
      customApiKey: options.apiKey,
      customBaseUrl: options.apiBaseUrl,
      modelName: model || undefined,
      approvalMode: options.approvalMode || 'dangerous',
    });

    const child =
      launch.kind === 'docker'
        ? spawnDocker(launch.args)
        : spawn(launch.command, launch.args, {
            cwd: launch.cwd,
            env: launch.env as NodeJS.ProcessEnv,
            stdio: ['pipe', 'pipe', 'pipe'],
          });

    const entry: RuntimeEntry = {
      key,
      child,
      containerName: launch.kind === 'docker' ? launch.containerName : undefined,
      envFile: launch.kind === 'docker' ? launch.envFile : undefined,
      buffer: '',
      turn: null,
      stopping: false,
      model,
      systemPrompt: options.workspaceSystemPrompt,
    };
    this.runtimes.set(key, entry);

    child.stdout?.on('data', (chunk: Buffer) => this.onStdout(entry, chunk.toString('utf-8')));
    child.stdin?.on('error', () => {
      // 进程已退出时写入 stdin 会触发 EPIPE，忽略即可
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = redactSecrets(chunk.toString('utf-8'), [options.apiKey, process.env.apiKey]);
      const turn = entry.turn;
      if (turn) {
        turn.options.onEvent({ type: 'terminal.chunk', data: { chunk: text, stream: 'stderr' } });
      }
    });
    child.on('error', (err) => this.failTurn(entry, err));
    child.on('close', (code) => {
      if (entry.turn) {
        this.failTurn(entry, new Error(`pi 进程已退出（code=${code ?? 'none'}）`));
      }
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      void removeSandboxEnvFile(entry.envFile);
      entry.stopping = true;
      if (this.runtimes.get(key) === entry) this.runtimes.delete(key);
    });

    return entry;
  }

  private send(entry: RuntimeEntry, message: Record<string, unknown>): void {
    if (!entry.child.stdin || entry.child.stdin.writableEnded) return;
    entry.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onStdout(entry: RuntimeEntry, chunk: string): void {
    entry.buffer += chunk;
    let index = entry.buffer.indexOf('\n');
    while (index >= 0) {
      const line = entry.buffer.slice(0, index).replace(/\r$/, '');
      entry.buffer = entry.buffer.slice(index + 1);
      if (line.trim()) this.handleLine(entry, line);
      index = entry.buffer.indexOf('\n');
    }
  }

  private handleLine(entry: RuntimeEntry, line: string): void {
    const turn = entry.turn;
    if (!turn) return;

    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    switch (message.type) {
      case 'response': {
        if (message.command === 'prompt' && message.success === false) {
          this.failTurn(entry, new Error(message.error || 'pi 拒绝了本次请求'));
        } else if (
          (message.command === 'steer' || message.command === 'follow_up') &&
          message.success === false
        ) {
          turn.options.onEvent({
            type: 'user.inject_failed',
            data: { command: message.command, error: message.error || 'pi 未接受该补充消息' },
          });
        }
        break;
      }
      case 'message_update': {
        // RPC 模式下 message_update 只带增量事件，不带累计 message 快照
        const deltaEvent = message.assistantMessageEvent || {};
        if (deltaEvent.type === 'text_delta' && typeof deltaEvent.delta === 'string' && deltaEvent.delta) {
          turn.options.onEvent({ type: 'message.delta', data: { delta: deltaEvent.delta } });
        } else if (
          deltaEvent.type === 'thinking_delta' &&
          typeof deltaEvent.delta === 'string' &&
          deltaEvent.delta
        ) {
          // 推理模型的思考流，前端折叠展示
          turn.options.onEvent({ type: 'message.thinking', data: { delta: deltaEvent.delta } });
        }
        break;
      }
      case 'message_end': {
        const usage = message.message?.usage;
        if (message.message?.role === 'assistant' && usage) {
          const totalTokens = Number(usage.totalTokens ?? (usage.input + usage.output));
          if (Number.isFinite(totalTokens)) {
            turn.options.onEvent({
              type: 'usage.updated',
              data: { totalTokens, contextWindow: turn.options.modelContextWindow },
            });
          }
        }
        break;
      }
      case 'tool_execution_start': {
        const info: ToolInfo = {
          toolCallId: String(message.toolCallId || message.id || ''),
          toolName: String(message.toolName || 'tool'),
          args: (message.args && typeof message.args === 'object' ? message.args : {}) as Record<string, any>,
        };
        if (!info.toolCallId) break;
        if (requiresApproval(info.toolName, turn.options.approvalMode || 'dangerous')) {
          // 等待审批扩展回传确认请求后再发 tool.started
          turn.pendingApprovals.push(info);
        } else {
          turn.options.onEvent({
            type: 'tool.started',
            data: {
              toolCallId: info.toolCallId,
              toolName: mapToolName(info.toolName),
              toolPreview: buildToolPreview(info.toolName, info.args),
              args: info.args,
            },
          });
        }
        break;
      }
      case 'tool_execution_update': {
        // partialResult 是累计输出（不是增量），前端直接替换显示
        const toolCallId = String(message.toolCallId || '');
        if (!toolCallId || turn.deniedTools.has(toolCallId)) break;
        const output = stringifyResult(message.partialResult);
        if (!output) break;
        turn.options.onEvent({
          type: 'tool.progress',
          data: {
            toolCallId,
            toolName: mapToolName(String(message.toolName || 'tool')),
            output,
          },
        });
        break;
      }
      case 'tool_execution_end': {
        const toolCallId = String(message.toolCallId || message.id || '');
        if (!toolCallId) break;
        if (turn.deniedTools.has(toolCallId)) {
          turn.deniedTools.delete(toolCallId);
          break;
        }
        const payload = {
          toolCallId,
          toolName: mapToolName(String(message.toolName || 'tool')),
          result: stringifyResult(message.result),
          error: message.isError ? stringifyResult(message.result) || '工具执行失败' : undefined,
        };
        turn.options.onEvent({
          type: message.isError ? 'tool.failed' : 'tool.completed',
          data: payload,
        });
        break;
      }
      case 'extension_ui_request': {
        void this.handleUiRequest(entry, turn, message);
        break;
      }
      case 'agent_settled': {
        this.settleTurn(entry, turn);
        break;
      }
      default:
        break;
    }
  }

  private async handleUiRequest(entry: RuntimeEntry, turn: TurnState, request: any): Promise<void> {
    const requestId = request?.id;
    if (!requestId) return;

    if (request.method !== 'confirm') {
      this.send(entry, { type: 'extension_ui_response', id: requestId, cancelled: true });
      return;
    }

    const tool = turn.pendingApprovals.shift() || {
      toolCallId: `pi_${requestId}`,
      toolName: 'tool',
      args: {},
    };

    const timeoutMs = 5 * 60 * 1000;
    const { approvalId, promise } = approvalStore.createApproval({
      runId: turn.options.runId,
      userId: turn.options.userId,
      toolCallId: tool.toolCallId,
      toolName: mapToolName(tool.toolName),
      toolPreview: buildToolPreview(tool.toolName, tool.args),
      args: tool.args,
      timeoutMs,
    });

    turn.options.onEvent({
      type: 'tool.approval_requested',
      data: {
        approvalId,
        toolCallId: tool.toolCallId,
        toolName: mapToolName(tool.toolName),
        toolPreview: buildToolPreview(tool.toolName, tool.args),
        args: tool.args,
        timeoutMs,
      },
    });

    let decision: ApprovalDecision;
    try {
      decision = await promise;
    } catch {
      decision = { action: 'deny', reason: '审批异常', timestamp: Date.now() };
    }

    this.send(entry, {
      type: 'extension_ui_response',
      id: requestId,
      confirmed: decision.action === 'approve',
    });

    if (decision.action === 'approve') {
      turn.options.onEvent({
        type: 'tool.started',
        data: {
          toolCallId: tool.toolCallId,
          toolName: mapToolName(tool.toolName),
          toolPreview: buildToolPreview(tool.toolName, tool.args),
          args: tool.args,
        },
      });
    } else {
      turn.deniedTools.add(tool.toolCallId);
      turn.options.onEvent({
        type: 'tool.failed',
        data: {
          toolCallId: tool.toolCallId,
          toolName: mapToolName(tool.toolName),
          isDenied: true,
          error: decision.reason || '用户拒绝执行该工具',
        },
      });
    }
  }

  private settleTurn(entry: RuntimeEntry, turn: TurnState): void {
    if (turn.settled) return;
    turn.settled = true;
    if (turn.timer) clearTimeout(turn.timer);
    if (turn.abortGraceTimer) clearTimeout(turn.abortGraceTimer);
    turn.detachAbort?.();
    entry.turn = null;
    turn.options.onEvent({ type: 'run.completed', data: { runId: turn.options.runId } });
    turn.resolve();

    entry.idleTimer = setTimeout(() => {
      this.stopRuntime(entry.key).catch(() => {});
    }, IDLE_TIMEOUT_MS);
    entry.idleTimer.unref?.();
  }

  private failTurn(entry: RuntimeEntry, err: Error): void {
    const turn = entry.turn;
    if (!turn || turn.settled) return;
    turn.settled = true;
    if (turn.timer) clearTimeout(turn.timer);
    if (turn.abortGraceTimer) clearTimeout(turn.abortGraceTimer);
    turn.detachAbort?.();
    entry.turn = null;
    turn.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

const globalForPiRuntime = globalThis as unknown as {
  almarenPiStudioRuntime?: PiStudioRuntime;
};

export const piStudioRuntime =
  globalForPiRuntime.almarenPiStudioRuntime ?? new PiStudioRuntime();

globalForPiRuntime.almarenPiStudioRuntime = piStudioRuntime;

export async function runStudioPiTurn(options: StudioPiTurnOptions): Promise<void> {
  return piStudioRuntime.runTurn(options);
}

/** 向正在执行的任务补充用户消息（steer 即时纠偏 / followUp 结束后追加） */
export async function injectStudioUserMessage(params: {
  userId: string;
  workspaceId: string;
  message: string;
  mode: 'steer' | 'followUp';
}): Promise<{ accepted: boolean; reason?: string }> {
  return piStudioRuntime.submitUserMessage(params);
}

/** 停止某个工作区的常驻 pi 进程（删除工作区时调用） */
export async function stopStudioPiRuntime(userId: string, workspaceId: string): Promise<void> {
  await piStudioRuntime.stopRuntime(`${userId}:${workspaceId}`);
}
