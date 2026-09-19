import path from 'node:path';
import fs from 'node:fs';
import { spawn, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolveUserWorkspace, resolveStudioWorkspace, buildSanitizedEnv } from './sandbox';
import { CODING_AGENTS_REGISTRY } from './registry';
import { checkAgentStatus } from './detector';
import { AgentSession, AgentSessionEvent, AgentSessionLaunchOptions, CodingAgentId } from './types';
import { killOwnedProcessTree, windowsCmdShimExecution } from './windows-compat';

const MAX_CONCURRENT_PER_USER = 1;
const MAX_GLOBAL_CONCURRENT = 5;
const MAX_SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_LOG_BUFFER_LINES = 1000;

interface ActiveProcessMeta {
  child?: ChildProcess;
  timeoutTimer?: NodeJS.Timeout;
}

class AgentSupervisor {
  private sessions = new Map<string, AgentSession>();
  private processes = new Map<string, ActiveProcessMeta>();

  /**
   * Launch a new agent execution session for a user in an isolated workspace.
   */
  async launchSession(options: AgentSessionLaunchOptions): Promise<AgentSession> {
    const { userId, spaceId = 'default', workspaceId, agentId, prompt, customApiKey } = options;

    if (!prompt || !prompt.trim()) {
      throw new Error('执行指令/需求不能为空');
    }

    // 1. Check user concurrency limit
    const userRunningCount = Array.from(this.sessions.values()).filter(
      (s) => s.userId === userId && s.status === 'RUNNING'
    ).length;
    if (userRunningCount >= MAX_CONCURRENT_PER_USER) {
      throw new Error('每个用户最多同时执行 1 个活跃任务，请等待当前任务结束或手动中止');
    }

    // 2. Check global concurrency limit
    const globalRunningCount = Array.from(this.sessions.values()).filter(
      (s) => s.status === 'RUNNING'
    ).length;
    if (globalRunningCount >= MAX_GLOBAL_CONCURRENT) {
      throw new Error('系统当前执行任务过多，请稍候再试');
    }

    // 3. Verify Agent status
    const meta = CODING_AGENTS_REGISTRY[agentId];
    if (!meta) {
      throw new Error(`未知的 Agent 类型: ${agentId}`);
    }

    const statusInfo = await checkAgentStatus(agentId);
    if (statusInfo.status !== 'installed') {
      throw new Error(
        `Agent [${meta.name}] 尚未在宿主机安装。\n请在终端运行: ${meta.installCommand}`
      );
    }

    // 4. Resolve safe workspace
    const workspaceDir =
      options.workspaceDir ||
      (workspaceId
        ? await resolveStudioWorkspace(process.cwd(), userId, workspaceId)
        : await resolveUserWorkspace(process.cwd(), userId, spaceId));

    // 5. Create session object
    const sessionId = randomUUID();
    const session: AgentSession = {
      id: sessionId,
      userId,
      spaceId,
      agentId,
      prompt: prompt.trim(),
      status: 'RUNNING',
      workspaceDir,
      startedAt: Date.now(),
      logBuffer: [],
      listeners: new Set(),
    };

    this.sessions.set(sessionId, session);

    // Initial system logs
    this.appendLog(session, `[SYSTEM] 🚀 正在为用户 [${userId}] 启动 ${meta.name} 会话...`);
    this.appendLog(session, `[SYSTEM] 📁 工作区沙箱已锁定: ${workspaceDir}`);
    this.appendLog(session, `[SYSTEM] 📋 执行需求: "${prompt.trim()}"`);

    // 6. Build command and arguments
    const isWin = process.platform === 'win32';
    let command = meta.command;
    let args: string[] = [];

    const localPiCli = path.resolve(process.cwd(), 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js');

    // Build sanitized env
    const env = buildSanitizedEnv({
      agentId,
      customApiKey,
      customBaseUrl: options.customBaseUrl,
    });

    if (agentId === 'pi') {
      command = process.execPath;
      if (options.customBaseUrl && customApiKey) {
        // Configure Pi custom provider with the user's proxy & model
        const piConfigDir = path.resolve(process.cwd(), 'data', 'studio', userId, '.pi_agent');
        fs.mkdirSync(piConfigDir, { recursive: true });
        const targetModel = options.modelName || 'gemini-3.7-flash-high';
        const modelsConfig = {
          providers: {
            custom: {
              baseUrl: options.customBaseUrl,
              api: 'openai-completions',
              apiKey: customApiKey,
              models: [
                {
                  id: targetModel,
                  name: targetModel,
                  reasoning: false,
                  input: ['text'],
                },
              ],
            },
          },
        };
        fs.writeFileSync(path.join(piConfigDir, 'models.json'), JSON.stringify(modelsConfig, null, 2), 'utf-8');
        env.PI_CODING_AGENT_DIR = piConfigDir;
        args = [localPiCli, '--provider', 'custom', '--model', targetModel, '-a', '-p', prompt.trim()];
      } else {
        args = [localPiCli, '-a', '-p', prompt.trim()];
      }
    } else if (agentId === 'claude-code') {
      args = ['-p', prompt.trim()];
    } else {
      args = [prompt.trim()];
    }

    let spawnCmd = command;
    let spawnArgs = args;
    let spawnOptions: Record<string, unknown> = {
      cwd: workspaceDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    };

    if (isWin && agentId !== 'pi') {
      const shim = windowsCmdShimExecution(spawnCmd, spawnArgs);
      spawnCmd = shim.command;
      spawnArgs = shim.args;
      spawnOptions.windowsVerbatimArguments = true;
    }

    try {
      const child = spawn(spawnCmd, spawnArgs, spawnOptions);
      // Close stdin immediately so interactive CLIs (like pi, node, python) do not hang waiting for EOF!
      child.stdin?.end();
      session.pid = child.pid;
      this.appendLog(session, `[SYSTEM] ⚡ 子进程已拉起 (PID: ${child.pid})`);

      const metaHolder: ActiveProcessMeta = { child };
      this.processes.set(sessionId, metaHolder);

      // Setup watchdog timeout
      metaHolder.timeoutTimer = setTimeout(() => {
        this.appendLog(session, `[TIMEOUT] ⚠️ 任务执行已超过 10 分钟最大时限，看门狗强制熔断终止。`);
        this.stopSession(userId, sessionId, '超时自动熔断');
      }, MAX_SESSION_TIMEOUT_MS);

      // Stdout listener
      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        this.emitEvent(session, {
          type: 'stdout',
          data: text,
          timestamp: Date.now(),
        });
      });

      // Stderr listener
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        this.emitEvent(session, {
          type: 'stderr',
          data: text,
          timestamp: Date.now(),
        });
      });

      // Child exit handler
      child.on('close', (code, signal) => {
        this.cleanupProcess(sessionId);
        session.endedAt = Date.now();
        session.exitCode = code;

        if (session.status === 'RUNNING') {
          session.status = code === 0 ? 'COMPLETED' : 'FAILED';
        }

        const duration = Math.round((session.endedAt - session.startedAt) / 1000);
        this.appendLog(
          session,
          `[SYSTEM] 🏁 任务结束 (退出码: ${code ?? 'none'}, 信号: ${signal ?? 'none'}, 耗时: ${duration}s, 最终状态: ${session.status})`
        );

        this.emitEvent(session, {
          type: 'exit',
          data: JSON.stringify({ code, signal, status: session.status, duration }),
          timestamp: Date.now(),
        });
      });

      child.on('error', (err) => {
        this.cleanupProcess(sessionId);
        session.endedAt = Date.now();
        session.status = 'FAILED';
        session.error = err.message;
        this.appendLog(session, `[ERROR] ❌ 进程发生错误: ${err.message}`);

        this.emitEvent(session, {
          type: 'error',
          data: err.message,
          timestamp: Date.now(),
        });
      });

      return session;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      session.status = 'FAILED';
      session.endedAt = Date.now();
      session.error = errorMsg;
      this.appendLog(session, `[ERROR] ❌ 启动子进程失败: ${errorMsg}`);
      throw err;
    }
  }

  /**
   * Stop an active session owned by the given user.
   */
  async stopSession(userId: string, sessionId: string, reason = '用户手动中止'): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.userId !== userId) {
      throw new Error('越权操作：无权中止属于其他用户的 Agent 进程');
    }

    if (session.status !== 'RUNNING') {
      return true;
    }

    const processMeta = this.processes.get(sessionId);
    session.status = 'STOPPED';
    session.endedAt = Date.now();

    this.appendLog(session, `[SYSTEM] 🛑 操作中止: ${reason}`);

    if (session.pid) {
      killOwnedProcessTree(session.pid, () => {
        processMeta?.child?.kill('SIGTERM');
      });
    }

    this.cleanupProcess(sessionId);

    this.emitEvent(session, {
      type: 'status',
      data: JSON.stringify({ status: 'STOPPED', reason }),
      timestamp: Date.now(),
    });

    return true;
  }

  getSession(userId: string, sessionId: string): AgentSession | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) return null;
    return session;
  }

  getUserSessions(userId: string): AgentSession[] {
    return Array.from(this.sessions.values())
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  subscribeSession(
    sessionId: string,
    listener: (event: AgentSessionEvent) => void
  ): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) return () => {};

    session.listeners.add(listener);
    return () => {
      session.listeners.delete(listener);
    };
  }

  private appendLog(session: AgentSession, line: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${line}`;
    session.logBuffer.push(formatted);
    if (session.logBuffer.length > MAX_LOG_BUFFER_LINES) {
      session.logBuffer.shift();
    }
    this.emitEvent(session, {
      type: 'stdout',
      data: formatted + '\n',
      timestamp: Date.now(),
    });
  }

  private emitEvent(session: AgentSession, event: AgentSessionEvent): void {
    for (const listener of session.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener error
      }
    }
  }

  private cleanupProcess(sessionId: string): void {
    const meta = this.processes.get(sessionId);
    if (meta?.timeoutTimer) {
      clearTimeout(meta.timeoutTimer);
    }
    this.processes.delete(sessionId);
  }
}

// Global supervisor singleton (attached to globalThis for Next.js cross-route consistency)
const globalForSupervisor = globalThis as unknown as {
  almarenAgentSupervisor?: AgentSupervisor;
};

export const agentSupervisor =
  globalForSupervisor.almarenAgentSupervisor ?? new AgentSupervisor();

globalForSupervisor.almarenAgentSupervisor = agentSupervisor;
