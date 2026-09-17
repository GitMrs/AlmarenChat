import path from 'node:path';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolveUserWorkspace, resolveStudioWorkspace } from './sandbox';
import { safeJoinReal } from './safe-path';
import { agentSupervisor } from './supervisor';
import { CodingAgentId } from './types';
import { createModelClient, resolveModelName } from '../model-client';

export interface CoordinatorEvent {
  type:
    | 'run.started'
    | 'tool.started'
    | 'tool.completed'
    | 'tool.failed'
    | 'message.delta'
    | 'usage.updated'
    | 'run.completed'
    | 'run.failed'
    | 'terminal.chunk';
  data: any;
}

export interface CoordinatorRunOptions {
  userId: string;
  spaceId?: string;
  workspaceId?: string;
  workspaceSystemPrompt?: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  reasoningEffort?: string;
  modelName?: string;
  modelContextWindow?: number;
  apiBaseUrl?: string;
  apiKey?: string;
  agentKeys?: {
    anthropicApiKey?: string;
    openaiApiKey?: string;
    deepseekApiKey?: string;
    xaiApiKey?: string;
  };
  onEvent: (event: CoordinatorEvent) => void;
  signal?: AbortSignal;
}

const COORDINATOR_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'workspace_scan',
      description: '扫描当前项目空间工作区的文件与目录树结构',
      parameters: {
        type: 'object',
        properties: {
          subPath: { type: 'string', description: '可选。扫描的相对子路径，默认当前根目录' },
          depth: { type: 'number', description: '扫描目录深度，默认 2' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: '读取工作区内的指定文件内容',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于工作区的具体文件路径，如 src/index.ts 或 README.md' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_file',
      description: '向工作区写入或修改代码、文档等文件',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件相对路径' },
          content: { type: 'string', description: '文件的完整代码或文本内容' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delegate_task',
      description:
        '核心协调能力：将独立的复杂子任务（如写代码、运行测试、生成模块）委派给专业的子智能体（如 Pi Coding Agent, Claude Code, Codex, DeepSeek Harness）执行',
      parameters: {
        type: 'object',
        properties: {
          agent: {
            type: 'string',
            enum: ['pi', 'claude-code', 'codex', 'dsh', 'opencode'],
            description: '指定的执行子智能体。系统内置默认推荐 pi',
          },
          goal: {
            type: 'string',
            description: '明确、自包含的具体交付目标与要求',
          },
          context: {
            type: 'string',
            description: '可选。执行该任务所需的代码文件路径、约束或背景上下文',
          },
        },
        required: ['agent', 'goal'],
      },
    },
  },
];

async function scanWorkspace(dir: string, currentDepth = 0, maxDepth = 2): Promise<string[]> {
  if (currentDepth > maxDepth) return [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const results: string[] = [];
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') {
        continue;
      }
      if (entry.isDirectory()) {
        results.push(`📁 ${entry.name}/`);
        const sub = await scanWorkspace(path.join(dir, entry.name), currentDepth + 1, maxDepth);
        results.push(...sub.map((s) => `  ${s}`));
      } else {
        results.push(`📄 ${entry.name}`);
      }
    }
    return results;
  } catch {
    return ['(空目录)'];
  }
}

export async function runCoordinatorChat(options: CoordinatorRunOptions): Promise<void> {
  const {
    userId,
    spaceId = 'default',
    workspaceId,
    message,
    history = [],
    reasoningEffort = 'high',
    modelName,
    modelContextWindow,
    apiBaseUrl,
    apiKey,
    agentKeys,
    onEvent,
    signal,
  } = options;

  onEvent({ type: 'run.started', data: { timestamp: Date.now() } });

  const resolvedWorkspaceId = workspaceId || spaceId || 'default';
  const workspaceDir = workspaceId
    ? await resolveStudioWorkspace(process.cwd(), userId, workspaceId)
    : await resolveUserWorkspace(process.cwd(), userId, resolvedWorkspaceId);
  const client = createModelClient(apiBaseUrl, apiKey);
  const resolvedModel = resolveModelName(modelName);

  const reasoningGuidance = {
    high: '【当前思考强度：高】请在执行工具和回复前进行严谨深度的推演，详细分析架构方案、子任务依赖图、潜在边界陷阱，并对生成的代码或命令进行自验复核后再下结论。',
    medium: '【当前思考强度：中】聚焦核心工程目标，进行结构化的思考，合理规划子任务并推进执行。',
    low: '【当前思考强度：低】快速思考核心路径，减少冗余分析，尽快调用工具交付结果。',
    none: '【当前思考强度：关闭】直接以最高效精炼的方式执行工具或给出直接答案，避免中间推演。',
  }[reasoningEffort as 'high' | 'medium' | 'low' | 'none'] || '';

  const temperatureByEffort = {
    high: 0.2,
    medium: 0.4,
    low: 0.6,
    none: 0.7,
  }[reasoningEffort as 'high' | 'medium' | 'low' | 'none'] || 0.3;

  const workspaceRules = options.workspaceSystemPrompt?.trim()
    ? `\n【当前工作空间专属指令与项目规范】：\n${options.workspaceSystemPrompt.trim()}\n在规划所有任务、生成代码及协调智能体时，请严格遵循上述空间规范。\n`
    : '';

  const systemPrompt = `你是 AlmarenChat Studio 的总指挥官兼协调智能体（Coordinator / 协调智能体团队）。
你的核心使命是帮助用户统筹大型复杂研发、设计与文档工作，并感知工作区。
${reasoningGuidance}
${workspaceRules}

你有以下原生工具可以使用：
1. \`workspace_scan\`：探测当前工作区目录结构。
2. \`read_file\`：阅读指定代码/文档内容。
3. \`write_file\`：产出或更新工作区中的文件。
4. \`delegate_task\`：将专业性强的子任务（如静态检查、算法编写、子模块重构）委派给专业的子智能体（如 Pi、Claude Code、Codex）执行。

行为准则：
- 面对用户综合性需求，先拆解出步骤与任务框架；
- 需要摸清项目背景时，主动调用 workspace_scan 扫描工作区；
- 需要修改或读取文件时，主动调用 read_file 或 write_file；
- 需要写代码、执行命令或安装依赖时，调用 delegate_task 委派给相应的子 Agent（优先推荐使用内置的 pi）；
- 【重要】当用户要求安装或引入外部 Skill（如 GitHub 仓库中的 Skill）时，在 delegate_task 的目标中必须明确要求：
  1. 将该 Skill 克隆/放置在工作区的 \`.pi/skills/<skill-name>/\` 目录下（例如：git clone <url> .pi/skills/<skill-name>）；
  2. 确认其内部包含合规的 \`SKILL.md\`（含 name 与 description 元数据）；
  3. 如此后续系统与 Pi 即可自动感知、自动索引并在匹配任务时按需自动调用该技能；
- 在最终回复中，以条理清晰、专业有力的风格给用户汇报整体交付进度和结论。`;

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: message },
  ];

  let estimatedInputTokens = Math.round(JSON.stringify(messages).length / 3);
  let totalOutputTokens = 0;
  let realPromptTokens = 0;
  let realCompletionTokens = 0;
  let realTotalTokens = 0;

  let iterations = 0;
  const maxIterations = 5;

  while (iterations < maxIterations) {
    if (signal?.aborted) {
      onEvent({ type: 'run.failed', data: { error: '已中止' } });
      return;
    }
    iterations++;

    // Call OpenAI API with tools
    const response = await client.chat.completions.create(
      {
        model: resolvedModel,
        messages,
        tools: COORDINATOR_TOOLS,
        tool_choice: 'auto',
        temperature: temperatureByEffort,
      },
      { signal }
    );

    // Track real API token usage if provided by provider
    if (response.usage) {
      realPromptTokens = response.usage.prompt_tokens || realPromptTokens;
      realCompletionTokens += response.usage.completion_tokens || 0;
      realTotalTokens = response.usage.total_tokens || (realPromptTokens + realCompletionTokens);
    }

    const choice = response.choices[0];
    const assistantMsg = choice.message;
    messages.push(assistantMsg);

    // If LLM has tool calls
    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      for (const toolCall of assistantMsg.tool_calls) {
        if (toolCall.type !== 'function') continue;
        const fnName = toolCall.function.name;
        const toolCallId = toolCall.id;
        let args: any = {};
        try {
          args = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          args = {};
        }

        // Preview label formatting
        let preview = '';
        if (fnName === 'workspace_scan') {
          preview = '正在扫描项目结构与工作区配置...';
        } else if (fnName === 'read_file') {
          preview = args.path || '读取文件';
        } else if (fnName === 'write_file') {
          preview = args.path ? `写入文件: ${args.path}` : '写入文件';
        } else if (fnName === 'delegate_task') {
          preview = `(${args.agent || 'pi'}) ${args.goal || '执行专业子任务'}`;
        }

        let delegatedSessionId: string | undefined = undefined;
        let delegatedAgentId: string | undefined = undefined;

        // If delegate_task, launch session early to get sessionId for live streaming
        if (fnName === 'delegate_task') {
          delegatedAgentId = (args.agent as CodingAgentId) || 'pi';
          let customApiKey: string | undefined = apiKey;
          if (delegatedAgentId === 'claude-code') customApiKey = agentKeys?.anthropicApiKey || apiKey;
          else if (delegatedAgentId === 'codex') customApiKey = agentKeys?.openaiApiKey || apiKey;
          else if (delegatedAgentId === 'dsh') customApiKey = agentKeys?.deepseekApiKey || apiKey;
          else if (delegatedAgentId === 'grok') customApiKey = agentKeys?.xaiApiKey || apiKey;
          else if (delegatedAgentId === 'pi') customApiKey = apiKey;

          try {
            const subSession = await agentSupervisor.launchSession({
              userId,
              spaceId,
              workspaceId,
              workspaceDir,
              agentId: delegatedAgentId as CodingAgentId,
              prompt: `${args.goal}\n${args.context ? `补充背景: ${args.context}` : ''}`,
              customApiKey,
              customBaseUrl: apiBaseUrl,
              modelName: resolvedModel,
            });
            delegatedSessionId = subSession.id;
          } catch (launchErr: unknown) {
            const msg = launchErr instanceof Error ? launchErr.message : String(launchErr);
            onEvent({
              type: 'tool.failed',
              data: { toolCallId, error: `启动子任务失败: ${msg}`, timestamp: Date.now() },
            });
            messages.push({ role: 'tool', tool_call_id: toolCallId, content: `启动子任务失败: ${msg}` });
            continue;
          }
        }

        // Emit tool.started with sessionId if available
        onEvent({
          type: 'tool.started',
          data: {
            toolCallId,
            toolName: fnName === 'workspace_scan' ? 'workspace' : fnName === 'read_file' ? 'read' : fnName === 'write_file' ? 'write' : 'delegate',
            toolPreview: preview,
            sessionId: delegatedSessionId,
            agentId: delegatedAgentId,
            args,
            timestamp: Date.now(),
          },
        });

        let resultText = '';
        try {
          if (fnName === 'workspace_scan') {
            const list = await scanWorkspace(workspaceDir, 0, args.depth || 2);
            resultText = `工作区根目录 [${path.basename(workspaceDir)}]:\n${list.join('\n')}`;
          } else if (fnName === 'read_file') {
            const filePath = await safeJoinReal(workspaceDir, args.path);
            if (!filePath) {
              throw new Error(`禁止越权读取工作区外文件: ${args.path}`);
            }
            const content = await readFile(filePath, 'utf-8');
            resultText = content.slice(0, 8000);
          } else if (fnName === 'write_file') {
            const filePath = await safeJoinReal(workspaceDir, args.path);
            if (!filePath) {
              throw new Error(`禁止越权写入工作区外文件: ${args.path}`);
            }
            await writeFile(filePath, args.content || '', 'utf-8');
            resultText = `已成功写入文件: ${args.path} (${args.content?.length || 0} 字符)`;
          } else if (fnName === 'delegate_task' && delegatedSessionId) {
            const subSession = agentSupervisor.getSession(userId, delegatedSessionId);
            if (subSession) {
              const unsubscribe = agentSupervisor.subscribeSession(delegatedSessionId, (evt) => {
                if (evt.type === 'stdout' || evt.type === 'stderr') {
                  onEvent({
                    type: 'terminal.chunk',
                    data: {
                      text: evt.data,
                      sessionId: delegatedSessionId,
                      agentId: delegatedAgentId,
                      timestamp: evt.timestamp,
                    },
                  });
                }
              });

              try {
                // Wait for completion (up to 30s in coordinator turn)
                const timeout = 30_000;
                const startWait = Date.now();
                while (subSession.status === 'RUNNING' && Date.now() - startWait < timeout) {
                  await new Promise((r) => setTimeout(r, 800));
                }

                const logsTail = subSession.logBuffer.slice(-12).join('\n');
                resultText = `子智能体 [${delegatedAgentId}] 状态: ${subSession.status}。\n执行日志摘要:\n${logsTail || '(无输出或已在后台运行)'}`;
              } finally {
                unsubscribe();
              }
            } else {
              resultText = `子智能体任务未能建立会话`;
            }
          } else {
            resultText = '未知工具';
          }

          onEvent({
            type: 'tool.completed',
            data: {
              toolCallId,
              toolName: fnName === 'workspace_scan' ? 'workspace' : fnName === 'read_file' ? 'read' : fnName === 'write_file' ? 'write' : 'delegate',
              toolPreview: preview,
              sessionId: delegatedSessionId,
              agentId: delegatedAgentId,
              result: resultText,
              timestamp: Date.now(),
            },
          });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          resultText = `工具执行失败: ${errMsg}`;
          onEvent({
            type: 'tool.failed',
            data: {
              toolCallId,
              sessionId: delegatedSessionId,
              error: errMsg,
              timestamp: Date.now(),
            },
          });
        }

        // Push tool output to LLM history
        messages.push({
          role: 'tool',
          tool_call_id: toolCallId,
          content: resultText,
        });
      }
      // Loop continues to let LLM process tool results!
    } else {
      // Final message generated!
      const content = assistantMsg.content || '';
      totalOutputTokens += Math.round(content.length / 3);

      // Stream content in chunks for a smooth streaming experience
      const chunkSize = 20;
      for (let i = 0; i < content.length; i += chunkSize) {
        const chunk = content.slice(i, i + chunkSize);
        onEvent({
          type: 'message.delta',
          data: { delta: chunk, text: chunk },
        });
        if (content.length > 50) {
          await new Promise((r) => setTimeout(r, 12));
        }
      }

      const contextWindow = modelContextWindow || 200_000;
      const finalTokens = realTotalTokens || (estimatedInputTokens + totalOutputTokens);

      onEvent({
        type: 'usage.updated',
        data: {
          totalTokens: finalTokens,
          promptTokens: realPromptTokens,
          completionTokens: realCompletionTokens,
          contextLength: contextWindow,
          remainingTokens: Math.max(0, contextWindow - finalTokens),
        },
      });

      onEvent({ type: 'run.completed', data: { timestamp: Date.now() } });
      return;
    }
  }

  onEvent({ type: 'run.completed', data: { timestamp: Date.now() } });
}
