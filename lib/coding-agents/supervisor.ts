import { spawn, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolveUserWorkspace, resolveStudioWorkspace, buildSanitizedEnv } from './sandbox';
import { CODING_AGENTS_REGISTRY } from './registry';
import { checkAgentStatus } from './detector';
import { AgentSession, AgentSessionEvent, AgentSessionLaunchOptions, CodingAgentId } from './types';
import { killOwnedProcessTree, windowsCmdShimExecution } from './windows-compat';
import { killStudioContainer, spawnDocker } from './sandbox/docker-driver';
import { buildPiLaunchSpec, PiLaunchSpec } from './pi-launch';
import { redactSecrets } from './secret-redaction';

const MAX_CONCURRENT_PER_USER = 1;
const MAX_GLOBAL_CONCURRENT = 5;
const MAX_SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_LOG_BUFFER_LINES = 1000;

interface ActiveProcessMeta {
  child?: ChildProcess;
  timeoutTimer?: NodeJS.Timeout;
  containerName?: string;
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
    const env = buildSanitizedEnv({
      agentId,
      customApiKey,
      customBaseUrl: options.customBaseUrl,
    });

    let spawnCmd = meta.command;
    let spawnArgs: string[] = [];
    const spawnOptions: Record<string, unknown> = {
      cwd: workspaceDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    };

    if (agentId === 'claude-code') {
      spawnArgs = ['-p', prompt.trim()];
    } else if (agentId !== 'pi') {
      spawnArgs = [prompt.trim()];
    }

    if (isWin && agentId !== 'pi') {
      const shim = windowsCmdShimExecution(spawnCmd, spawnArgs);
      spawnCmd = shim.command;
      spawnArgs = shim.args;
      spawnOptions.windowsVerbatimArguments = true;
    }

    try {
      // pi 优先在 Docker 沙箱内执行；Docker 不可用时的行为由 STUDIO_SANDBOX_MODE 决定
      let piLaunch: PiLaunchSpec | null = null;
      if (agentId === 'pi') {
        piLaunch = await buildPiLaunchSpec({
          sessionId,
          userId,
          workspaceDir,
          agentArgs: ['-a', '-p', prompt.trim()],
          customApiKey,
          customBaseUrl: options.customBaseUrl,
          modelName: options.modelName,
        });
        session.sandboxMode = piLaunch.kind === 'docker' ? 'docker' : 'host';
        session.containerName = piLaunch.kind === 'docker' ? piLaunch.containerName : undefined;
        this.appendLog(
          session,
          piLaunch.kind === 'docker'
            ? `[SYSTEM] 🐳 沙箱模式：Docker 容器 (${piLaunch.containerName})`
            : `[SYSTEM] 💻 沙箱模式：宿主进程`
        );
      }

      const child = piLaunch
        ? piLaunch.kind === 'docker'
          ? spawnDocker(piLaunch.args)
          : spawn(piLaunch.command, piLaunch.args, {
              cwd: piLaunch.cwd,
              env: piLaunch.env as NodeJS.ProcessEnv,
              stdio: ['pipe', 'pipe', 'pipe'],
            })
        : spawn(spawnCmd, spawnArgs, spawnOptions);
      // Close stdin immediately so interactive CLIs (like pi, node, python) do not hang waiting for EOF!
      child.stdin?.end();
      session.pid = child.pid;
      this.appendLog(session, `[SYSTEM] ⚡ 子进程已拉起 (PID: ${child.pid})`);

      const metaHolder: ActiveProcessMeta = { child, containerName: session.containerName };
      this.processes.set(sessionId, metaHolder);

      // Setup watchdog timeout
      metaHolder.timeoutTimer = setTimeout(() => {
        this.appendLog(session, `[TIMEOUT] ⚠️ 任务执行已超过 10 分钟最大时限，看门狗强制熔断终止。`);
        this.stopSession(userId, sessionId, '超时自动熔断');
      }, MAX_SESSION_TIMEOUT_MS);

      const secrets = [customApiKey, process.env.apiKey, process.env.OPENAI_API_KEY];

      // Stdout listener
      child.stdout?.on('data', (chunk: Buffer) => {
        const text = redactSecrets(chunk.toString('utf-8'), secrets);
        this.emitEvent(session, {
          type: 'stdout',
          data: text,
          timestamp: Date.now(),
        });
      });

      // Stderr listener
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = redactSecrets(chunk.toString('utf-8'), secrets);
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

    if (processMeta?.containerName) {
      // 杀掉 docker CLI 不会停止容器，必须显式 rm -f
      await killStudioContainer(processMeta.containerName);
    }
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
