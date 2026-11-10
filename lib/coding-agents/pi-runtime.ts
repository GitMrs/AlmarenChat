import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolveStudioWorkspace } from './sandbox';
import { buildPiLaunchSpec, PI_SESSION_PLACEHOLDER, type PiLaunchSpec } from './pi-launch';
import { killStudioContainer, removeSandboxEnvFile, spawnDocker } from './sandbox/docker-driver';
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from '../core/model-client';
import { contextUsage, readWorkspaceSkills, runtimeSettingsDigest } from './runtime-settings';
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
  /** 从服务端对话记录重建上下文时，丢弃旧的 pi 会话 */
  resetSession?: boolean;
  onEvent: (event: StudioRunEvent) => void;
}

interface ToolInfo {
  toolCallId: string;
  toolName: string;
  args: Record<string, any>;
}

interface QueuedInput {
  id: string;
  text: string;
  message: string;
  mode: 'steer' | 'followUp';
  pending: boolean;
}

interface TurnState {
  options: StudioPiTurnOptions;
  resolve: () => void;
  reject: (err: Error) => void;
  settled: boolean;
  pendingApprovals: ToolInfo[];
  deniedTools: Set<string>;
  queue: { steering: string[]; followUp: string[] };
  queuedInputs: QueuedInput[];
  queueInput?: string;
  replayInput?: QueuedInput;
  rebuildingQueue?: boolean;
  piSettled?: boolean;
  queueOperation?: Promise<unknown>;
  waitingPrompts: Set<string>;
  phase: string;
  status?: string;
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
  settingsDigest: string;
  requests: Map<string, { resolve: (data: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>;
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
  private activeTurns = new Set<string>();

  async runTurn(options: StudioPiTurnOptions): Promise<void> {
    const key = `${options.userId}:${options.workspaceId}`;
    if (this.activeTurns.has(key)) {
      throw new Error('当前工作区上一条消息仍在执行，请稍候再试');
    }
    this.activeTurns.add(key);
    try {
      await this.runWorkspaceTurn(key, options);
    } finally {
      this.activeTurns.delete(key);
    }
  }

  private async runWorkspaceTurn(key: string, options: StudioPiTurnOptions): Promise<void> {
    if (options.signal?.aborted) throw new Error('会话已取消');
    if (options.resetSession) {
      await this.resetSession(key, options);
    }
    const entry = await this.acquireRuntime(key, options);
    if (options.signal?.aborted) {
      await this.stopRuntime(key);
      throw new Error('会话已取消');
    }
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
        queue: { steering: [], followUp: [] },
        queuedInputs: [],
        waitingPrompts: new Set(),
        phase: 'running',
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
        // Pi continues queued work after abort unless it is cleared first.
        this.send(entry, { type: 'clear_queue' });
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
      this.emitStatus(turn);
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
    runId?: string;
  }): Promise<{ accepted: boolean; reason?: string; disposition?: string }> {
    const key = `${params.userId}:${params.workspaceId}`;
    const entry = this.runtimes.get(key);
    const turn = entry?.turn;
    if (!entry || !turn || turn.settled || turn.options.signal?.aborted || (params.runId && params.runId !== turn.options.runId)) {
      return { accepted: false, reason: '当前工作区没有正在执行的任务' };
    }

    return this.mutateQueue(entry, turn, async () => {
      turn.queueInput = params.message;
      try {
        const data = await this.request(entry, {
          type: params.mode === 'steer' ? 'steer' : 'follow_up', message: params.message,
        });
        return { accepted: true, disposition: data?.disposition || 'queued' };
      } finally {
        turn.queueInput = undefined;
      }
    });
  }

  async clearQueue(params: { userId: string; workspaceId: string; runId: string }): Promise<void> {
    const entry = this.runtimes.get(`${params.userId}:${params.workspaceId}`);
    const turn = entry?.turn;
    if (!entry || !turn || turn.options.runId !== params.runId) throw new Error('当前任务已结束或已切换');
    await this.mutateQueue(entry, turn, () => this.request(entry, { type: 'clear_queue' }));
  }

  async cancelQueuedMessage(params: { userId: string; workspaceId: string; runId: string; itemId: string }): Promise<boolean> {
    const entry = this.runtimes.get(`${params.userId}:${params.workspaceId}`);
    const turn = entry?.turn;
    if (!entry || !turn || turn.options.runId !== params.runId) throw new Error('当前任务已结束或已切换');
    return this.mutateQueue(entry, turn, async () => {
      if (!turn.queuedInputs.some(item => item.id === params.itemId && item.pending)) return false;
      turn.rebuildingQueue = true;
      let remaining: QueuedInput[] = [];
      try {
        const cleared = await this.request(entry, { type: 'clear_queue' });
        const removed: QueuedInput[] = cleared.items;
        const cancelled = removed.some(item => item.id === params.itemId);
        remaining = removed.filter(item => item.id !== params.itemId);
        while (remaining.length) {
          if (entry.turn !== turn || turn.options.signal?.aborted) throw new Error('当前任务已结束或已切换');
          const item = remaining[0];
          turn.replayInput = item;
          turn.queuedInputs.push(item);
          const wasSettled = turn.piSettled;
          turn.piSettled = false;
          // prompt queues during execution and starts a continuation if Pi became
          // idle during clear/replay. Replay expanded text, retaining the original ID.
          try {
            const result = await this.request(entry, { type: 'prompt', message: item.text, streamingBehavior: item.mode });
            if (result?.disposition === 'handled') throw new Error('恢复的消息被扩展接管');
          } catch (error) {
            turn.piSettled = turn.piSettled || wasSettled;
            turn.queuedInputs = turn.queuedInputs.filter(queued => queued !== item || queued.pending);
            throw error;
          }
          remaining.shift();
        }
        return cancelled;
      } catch (error) {
        if (remaining.length && !turn.options.signal?.aborted) {
          turn.options.onEvent({ type: 'run.notice', data: {
            message: `取消操作未能恢复以下待处理消息，请核对后重新发送：\n${remaining.map(item => item.message).join('\n')}`,
          } });
        }
        throw error;
      } finally {
        turn.replayInput = undefined;
        turn.rebuildingQueue = false;
        if (entry.turn === turn) {
          this.emitQueue(turn);
          if (turn.piSettled) this.settleTurn(entry, turn);
        }
      }
    });
  }

  private emitQueue(turn: TurnState): void {
    if (turn.rebuildingQueue) return;
    turn.options.onEvent({ type: 'queue.updated', data: {
      runId: turn.options.runId, ...turn.queue,
      items: turn.queuedInputs.filter(item => item.pending).map(({ id, message, mode }) => ({ id, message, mode })),
    } });
  }

  private async mutateQueue<T>(entry: RuntimeEntry, turn: TurnState, operation: () => Promise<T>): Promise<T> {
    const result = (turn.queueOperation || Promise.resolve()).catch(() => {}).then(() => {
      if (entry.turn !== turn || turn.settled || turn.options.signal?.aborted) throw new Error('当前任务已结束或已切换');
      return operation();
    });
    turn.queueOperation = result;
    return result;
  }

  private request(entry: RuntimeEntry, command: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        const error = new Error('Pi 未确认消息操作，已停止本次运行，请核对聊天记录后重试');
        this.failTurn(entry, error);
        void this.stopRuntime(entry.key);
      }, 10000);
      entry.requests.set(id, { resolve, reject, timer });
      this.send(entry, { ...command, id });
    });
  }

  private emitStatus(turn: TurnState): void {
    const status = turn.waitingPrompts.size ? 'waiting_confirmation' : turn.phase;
    if (status === turn.status) return;
    turn.status = status;
    turn.options.onEvent({ type: 'run.status', data: { runId: turn.options.runId, status } });
  }

  private rejectRequests(entry: RuntimeEntry): void {
    for (const request of entry.requests.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('当前任务已结束或连接已断开'));
    }
    entry.requests.clear();
  }

  /** 丢弃工作区常驻进程与会话文件，开启全新上下文 */
  async resetSession(key: string, options: Pick<StudioPiTurnOptions, 'userId' | 'workspaceId'>): Promise<void> {
    await this.stopRuntime(key);
    const workspaceDir = await resolveStudioWorkspace(process.cwd(), options.userId, options.workspaceId);
    const sessionFile = path.join(
      path.dirname(workspaceDir),
      'sessions',
      `${stableSessionId(options.userId, options.workspaceId)}.jsonl`
    );
    await rm(sessionFile, { force: true });
  }

  /** 结束某个工作区的常驻进程（删除工作区/服务关闭时调用） */
  async stopRuntime(key: string): Promise<void> {
    const entry = this.runtimes.get(key);
    if (!entry) return;
    entry.stopping = true;
    this.rejectRequests(entry);
    this.runtimes.delete(key);
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    if (entry.containerName) {
      await killStudioContainer(entry.containerName);
    }
    if (entry.child.exitCode === null && !entry.child.signalCode) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => entry.child.kill('SIGKILL'), 3000);
        timer.unref?.();
        entry.child.once('close', () => { clearTimeout(timer); resolve(); });
        entry.child.stdin?.end();
        entry.child.kill('SIGTERM');
      });
    }
    await removeSandboxEnvFile(entry.envFile);
  }

  private async acquireRuntime(key: string, options: StudioPiTurnOptions): Promise<RuntimeEntry> {
    const model = options.modelName || DEFAULT_MODEL;
    const workspaceDir = await resolveStudioWorkspace(process.cwd(), options.userId, options.workspaceId);
    const skills = await readWorkspaceSkills(workspaceDir);
    const settingsDigest = runtimeSettingsDigest({
      model,
      systemPrompt: options.workspaceSystemPrompt,
      apiBaseUrl: options.apiBaseUrl || DEFAULT_BASE_URL,
      apiKey: options.apiKey || process.env.apiKey || process.env.OPENAI_API_KEY || '',
      approvalMode: options.approvalMode || 'dangerous',
      contextLength: options.modelContextWindow || 200000,
      skills,
    });
    const existing = this.runtimes.get(key);
    if (
      existing &&
      !existing.stopping &&
      existing.child.exitCode === null &&
      existing.settingsDigest === settingsDigest
    ) {
      return existing;
    }
    if (existing) {
      await this.stopRuntime(key);
    }

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

    for (const skill of skills) agentArgs.push('--skill', skill.path);

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
      modelContextWindow: options.modelContextWindow || 200000,
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
      settingsDigest,
      requests: new Map(),
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
      this.rejectRequests(entry);
      if (entry.turn) {
        this.failTurn(entry, new Error(`pi 进程已退出（code=${code ?? 'none'}）`));
      }
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      if (!entry.stopping) void removeSandboxEnvFile(entry.envFile);
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
        const removed: QueuedInput[] = [];
        if (message.command === 'clear_queue' && message.success) {
          // A removed item is not a delivered user message. Remove from the end:
          // an identical earlier item may already be starting while clear runs.
          for (const [key, mode] of [['steering', 'steer'], ['followUp', 'followUp']] as const) {
            const group: QueuedInput[] = [];
            for (const text of [...(message.data?.[key] || [])].reverse()) {
              const index = turn.queuedInputs.findLastIndex((item) => item.mode === mode && item.text === text);
              if (index >= 0) group.unshift(...turn.queuedInputs.splice(index, 1));
            }
            removed.push(...group);
          }
        }
        const pending = entry.requests.get(message.id);
        if (pending) {
          entry.requests.delete(message.id);
          clearTimeout(pending.timer);
          if (message.success) pending.resolve(message.command === 'clear_queue' ? { ...message.data, items: removed } : message.data);
          else pending.reject(new Error(message.error || 'Pi 未接受该操作'));
        }
        if (message.command === 'prompt' && message.success === false && !pending) {
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
      case 'queue_update': {
        const next = { steering: message.steering || [], followUp: message.followUp || [] };
        for (const [key, mode] of [['steering', 'steer'], ['followUp', 'followUp']] as const) {
          const previous = turn.queuedInputs.filter(item => item.pending && item.mode === mode);
          // Pi removes the earliest identical message on consumption. Preserve
          // the later IDs when a snapshot contains fewer copies of the same text.
          const counts = new Map<string, number>();
          for (const text of next[key]) counts.set(text, (counts.get(text) || 0) + 1);
          const kept = new Set<QueuedInput>();
          for (const item of [...previous].reverse()) {
            const count = counts.get(item.text) || 0;
            item.pending = count > 0;
            if (item.pending) { counts.set(item.text, count - 1); kept.add(item); }
          }
          for (const text of next[key]) {
            const item = previous.find(item => kept.has(item) && item.text === text);
            if (item) kept.delete(item);
            else if (turn.replayInput?.text === text && turn.replayInput.mode === mode && !turn.replayInput.pending) {
              turn.replayInput.pending = true;
            } else turn.queuedInputs.push({ id: randomUUID(), text, message: turn.queueInput || text, mode, pending: true });
          }
        }
        turn.queue = next;
        this.emitQueue(turn);
        break;
      }
      case 'message_start': {
        if (message.message?.role !== 'user') break;
        const content = message.message.content;
        const text = typeof content === 'string' ? content : (content || []).filter((block: any) => block.type === 'text').map((block: any) => block.text).join('');
        let index = turn.queuedInputs.findIndex((item) => item.text === text && item.mode === 'steer' && !item.pending);
        if (index < 0) index = turn.queuedInputs.findIndex((item) => item.text === text && !item.pending);
        if (index < 0) index = turn.queuedInputs.findIndex((item) => item.text === text);
        if (index >= 0) {
          const [item] = turn.queuedInputs.splice(index, 1);
          turn.options.onEvent({ type: 'user.message_injected', data: {
            message: item.message, mode: item.mode, queueItemId: item.id, userMessageId: randomUUID(), assistantMessageId: randomUUID(),
          } });
        }
        break;
      }
      case 'compaction_start':
        turn.phase = 'compacting';
        this.emitStatus(turn);
        break;
      case 'compaction_end':
        turn.phase = 'running';
        this.emitStatus(turn);
        if (message.errorMessage) turn.options.onEvent({ type: 'run.notice', data: { message: `上下文压缩失败：${message.errorMessage}` } });
        break;
      case 'message_update': {
        // RPC 模式下 message_update 只带增量事件，不带累计 message 快照
        const deltaEvent = message.assistantMessageEvent || {};
        if (deltaEvent.type === 'thinking_delta' || deltaEvent.type === 'text_delta') {
          turn.phase = deltaEvent.type === 'thinking_delta' ? 'thinking' : 'responding';
          this.emitStatus(turn);
        }
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
          const data = contextUsage(usage, turn.options.modelContextWindow || 200000);
          if (data) {
            turn.options.onEvent({
              type: 'usage.updated',
              data,
            });
          }
        }
        break;
      }
      case 'tool_execution_start': {
        turn.phase = 'running';
        this.emitStatus(turn);
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
        turn.piSettled = true;
        if (!turn.rebuildingQueue) this.settleTurn(entry, turn);
        break;
      }
      case 'agent_start': {
        turn.piSettled = false;
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
    turn.waitingPrompts.add(requestId);
    this.emitStatus(turn);
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

    turn.waitingPrompts.delete(requestId);
    if (entry.turn !== turn || turn.settled) return;
    this.emitStatus(turn);
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
    this.rejectRequests(entry);
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
    this.rejectRequests(entry);
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
  runId?: string;
}): Promise<{ accepted: boolean; reason?: string; disposition?: string }> {
  return piStudioRuntime.submitUserMessage(params);
}

export async function clearStudioMessageQueue(params: { userId: string; workspaceId: string; runId: string }): Promise<void> {
  return piStudioRuntime.clearQueue(params);
}

export async function cancelStudioQueuedMessage(params: { userId: string; workspaceId: string; runId: string; itemId: string }): Promise<boolean> {
  return piStudioRuntime.cancelQueuedMessage(params);
}

/** 停止某个工作区的常驻 pi 进程（删除工作区时调用） */
export async function stopStudioPiRuntime(userId: string, workspaceId: string): Promise<void> {
  await piStudioRuntime.stopRuntime(`${userId}:${workspaceId}`);
}

export async function resetStudioPiSession(userId: string, workspaceId: string): Promise<void> {
  await piStudioRuntime.resetSession(`${userId}:${workspaceId}`, { userId, workspaceId });
}
