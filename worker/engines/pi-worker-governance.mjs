import path from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import {
  executeWorkspaceTool,
  safeCommandToolSchema,
  workspaceToolSchemas,
} from '../../lib/agent-runtime/runtime-tools.mjs';
import { authorizationAllowsCapability } from '../../lib/agent-runtime-v3-policy.mjs';
import {
  skillAllowsTool,
  skillExecutionToolSchema,
  spaceSkillReferenceToolSchema,
  taskSkill,
} from '../../lib/agent-runtime/skill-registry.mjs';
import { readSpaceSkillFile } from '../../lib/space-skills.mjs';
import { workspaceAttemptRoot } from '../../lib/workspace-staging.mjs';
import { blocksUnapprovedFullOverwrite } from '../policies/workspace-write-policy.mjs';
import { executeSkill } from '../runtime/builtin-skill-runtime.mjs';
import {
  generateImageToolSchema,
  generateImagesToolSchema,
  generateWorkspaceImages,
} from '../runtime/image-generation-runtime.mjs';
import { reserveModelRequest } from '../runtime/model-budget.mjs';

const READ_TOOLS = new Set(['list_files', 'read_file', 'check_files']);
const TOOL_LABELS = {
  list_files: '列出文件',
  read_file: '读取文件',
  write_file: '写入文件',
  patch_file: '修改文件',
  patch_files: '批量修改文件',
  check_files: '检查文件',
  run_check: '静态检查',
  read_skill_file: '读取 Skill 资料',
  run_skill: '运行 Skill',
  generate_images: '生成图片',
  generate_image: '生成图片',
};

function safeId(value, label) {
  const id = String(value || '');
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`${label}格式不安全`);
  return id;
}

function toolResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    details: value,
    isError,
  };
}

function workspaceWriteAllowed(request, skill) {
  if (request.mode === 'advisor') return Boolean(request.workspaceWriteAllowed);
  return authorizationAllowsCapability(request.context?.authorization, 'workspace_write')
    && (skillAllowsTool(skill, 'write_file') || skillAllowsTool(skill, 'patch_file')
      || skillAllowsTool(skill, 'generate_images') || skillAllowsTool(skill, 'generate_image'));
}

function createPiWorkspaceTools(request, skill) {
  const canWrite = workspaceWriteAllowed(request, skill);
  const schemas = [
    ...workspaceToolSchemas.filter((tool) => skillAllowsTool(skill, tool.function.name)
      && (canWrite || READ_TOOLS.has(tool.function.name))),
    ...(canWrite && skillAllowsTool(skill, safeCommandToolSchema.function.name) ? [safeCommandToolSchema] : []),
  ];
  return schemas.map((schema) => defineTool({
    name: schema.function.name,
    label: TOOL_LABELS[schema.function.name] || schema.function.name,
    description: schema.function.description,
    parameters: Type.Unsafe(schema.function.parameters),
    execute: async (_toolCallId, args, signal) => {
      const name = schema.function.name;
      if (name === 'write_file' && blocksUnapprovedFullOverwrite(
        args.path,
        request.baselinePaths || new Set(),
        `${request.run?.input || ''}\n${request.task?.instruction || ''}`
      )) {
        return toolResult({
          error: '该文件在任务开始前已经存在，当前方案没有批准整体覆盖。请先读取并使用 patch_file 精确修改。',
        }, true);
      }
      try {
        const result = await executeWorkspaceTool({
          ...request.workspaceOptions,
          isCancelled: () => Boolean(signal?.aborted) || Boolean(request.isCancelled?.()),
          onMutation: async (relativePath) => {
            request.context?.touchedPaths?.add(relativePath);
            await request.registerWorkspaceFile?.(relativePath);
          },
          onToolCall: (toolName, toolArgs, toolOutput) => request.emit?.(
            request.run.id,
            'TOOL_COMPLETED',
            `${request.agent?.name || '成员'}已执行 ${toolName}`,
            {
              taskId: request.task.id,
              agentId: request.agent?.id || null,
              attempt: request.task.attempt,
              tool: toolName,
              path: String(toolArgs?.path || '').slice(0, 300) || null,
              paths: toolName === 'patch_files' ? (toolOutput?.paths || []).slice(0, 20) : undefined,
              valid: toolName === 'check_files' ? Boolean(toolOutput?.valid) : undefined,
              engine: 'pi',
            }
          ),
        }, name, args);
        return toolResult(result);
      } catch (error) {
        return toolResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    },
  }));
}

function schemaTool(schema, execute) {
  return defineTool({
    name: schema.function.name,
    label: TOOL_LABELS[schema.function.name] || schema.function.name,
    description: schema.function.description,
    parameters: Type.Unsafe(schema.function.parameters),
    execute,
  });
}

function createPiCapabilityTools(request, skill, state) {
  const tools = [];
  const referenceSchema = spaceSkillReferenceToolSchema(skill);
  if (referenceSchema) {
    tools.push(schemaTool(referenceSchema, async (_toolCallId, args) => {
      try {
        return toolResult(await readSpaceSkillFile({
          projectRoot: request.workspaceOptions.projectRoot,
          userId: request.workspaceOptions.userId,
          spaceId: request.workspaceOptions.spaceId,
          skillId: skill.id,
          digest: skill.digest,
          relativePath: args.path,
          offset: args.offset,
          limit: args.limit,
        }));
      } catch (error) {
        return toolResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    }));
  }

  const canExecuteSkill = authorizationAllowsCapability(request.context?.authorization, 'workspace_read')
    && authorizationAllowsCapability(request.context?.authorization, 'code_execute')
    && skillAllowsTool(skill, 'run_skill')
    && Boolean(skill.execution);
  const executionSchema = canExecuteSkill ? skillExecutionToolSchema(skill) : null;
  if (executionSchema) {
    tools.push(schemaTool(executionSchema, async (_toolCallId, args, signal) => {
      try {
        const result = await executeSkill({
          projectRoot: request.workspaceOptions.projectRoot,
          skill,
          args,
          workspaceOptions: request.workspaceOptions,
          isCancelled: () => Boolean(signal?.aborted) || Boolean(request.isCancelled?.()),
        });
        for (const relativePath of result.paths || []) {
          request.context?.touchedPaths?.add(relativePath);
          await request.registerWorkspaceFile?.(relativePath);
        }
        return toolResult(result, result?.ok === false);
      } catch (error) {
        return toolResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    }));
  }

  const canGenerateImage = workspaceWriteAllowed(request, skill)
    && authorizationAllowsCapability(request.context?.authorization, 'image_generate')
    && Boolean(request.context?.imageModel);
  const imageSchema = skillAllowsTool(skill, 'generate_images')
    ? generateImagesToolSchema
    : skillAllowsTool(skill, 'generate_image') ? generateImageToolSchema : null;
  if (canGenerateImage && imageSchema) {
    let attempted = false;
    tools.push(schemaTool(imageSchema, async (_toolCallId, args, signal) => {
      if (attempted) return toolResult({ error: '当前执行批次只能尝试一次图片生成，需要用户确认后再试' }, true);
      attempted = true;
      const legacy = imageSchema.function.name === 'generate_image';
      const images = legacy
        ? [{ prompt: args.prompt, fileName: args.fileName, size: args.size, purpose: '当前步骤图片' }]
        : args.images;
      if (!Array.isArray(images) || images.length !== 1) {
        return toolResult({ error: '当前执行批次必须且只能生成 1 张图片' }, true);
      }
      try {
        const result = await generateWorkspaceImages({
          model: request.context.imageModel,
          images,
          workspaceOptions: request.workspaceOptions,
          isCancelled: () => Boolean(signal?.aborted) || Boolean(request.isCancelled?.()),
        });
        for (const image of result.images || []) {
          request.context?.touchedPaths?.add(image.path);
          await request.registerWorkspaceFile?.(image.path);
        }
        if (result.failures?.length) {
          if (typeof request.pauseForInput === 'function') {
            await request.pauseForInput({
              question: '本次图片生成未成功，请检查图片模型配置后回复“继续”再尝试。',
              reason: result.failures[0].error,
            });
            state.paused = true;
          }
          return toolResult({ error: result.failures[0].error, retryAfterConfirmation: true }, true);
        }
        return toolResult(result);
      } catch (error) {
        return toolResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    }));
  }
  return tools;
}

function workerPiPaths(request) {
  const { projectRoot, userId, spaceId } = request.workspaceOptions || {};
  const runId = safeId(request.run?.id, 'Run ID');
  const taskId = safeId(request.task?.id, 'Task ID');
  const attempt = Math.max(1, Number(request.task?.attempt) || 1);
  const spaceRoot = path.resolve(
    projectRoot,
    'data',
    'spaces',
    safeId(userId, '用户 ID'),
    safeId(spaceId, '空间 ID')
  );
  const runtimeRoot = path.join(spaceRoot, '.runtime', 'pi-worker');
  return {
    workspaceRoot: workspaceAttemptRoot(request.workspaceOptions),
    runtimeRoot,
    sessionDir: path.join(runtimeRoot, 'sessions', runId, taskId, String(attempt)),
  };
}

function taskPrompt(request, skill) {
  const agentPrompt = request.agent?.systemPrompt || request.agent?.description || `你是${request.agent?.name || '任务执行者'}。`;
  const acceptance = String(request.task?.acceptanceCriteria || '').trim();
  return {
    systemPrompt: [
      agentPrompt,
      request.agent?.memoryContext || '',
      '你正在通过 Almaren Worker 管理的 Pi 执行引擎完成一个已批准步骤。只能使用本轮提供的工具。',
      request.mode === 'executor'
        ? '不得绕过工作区、联网、Skill、审批和预算限制。执行任务必须通过 submit_task_result 提交，普通文字不能结束步骤。'
        : '不得绕过工作区、联网、Skill、审批和预算限制。顾问任务完成后直接给出简洁、可审核的结论。',
      request.context?.space?.instructions ? `空间规则：\n${request.context.space.instructions}` : '',
      `当前步骤采用 Skill：${skill.name}（${skill.id}@${skill.version}）\n${skill.instructions || ''}`,
    ].filter(Boolean).join('\n\n'),
    message: [
      `总目标：${request.run?.input || request.run?.goal || ''}`,
      `当前步骤：${request.task?.title || ''}\n${request.task?.instruction || ''}`,
      acceptance ? `验收标准：\n${acceptance}` : '',
      request.task?.reviewFeedback ? `返工要求：\n${request.task.reviewFeedback}` : '',
      request.task?.waitAnswer ? `用户补充：\n${request.task.waitAnswer}` : '',
      request.previousResults?.length
        ? `已批准的前序结果：\n${request.previousResults.map((item) => `【${item.title}】\n${item.result}`).join('\n\n').slice(-12_000)}`
        : '',
      request.context?.researchContext ? `受控联网资料：\n${request.context.researchContext}` : '',
      request.context?.projectMemory ? String(request.context.projectMemory) : '',
    ].filter(Boolean).join('\n\n'),
  };
}

export function createPiWorkerGovernance({
  db,
  now = () => new Date().toISOString(),
  reserveRequest = reserveModelRequest,
} = {}) {
  if (!db) throw new TypeError('Pi Worker governance requires db');

  return async function buildSessionOptions(request) {
    const runId = safeId(request.run?.id, 'Run ID');
    const taskId = safeId(request.task?.id, 'Task ID');
    const attempt = Math.max(1, Number(request.task?.attempt) || 1);
    const skill = taskSkill(request.task);
    const state = { paused: false, submitted: false, result: '', manifest: null };
    const prompt = taskPrompt(request, skill);
    const workspaceTools = createPiWorkspaceTools(request, skill);
    const capabilityTools = createPiCapabilityTools(request, skill, state);

    const requestInputTool = defineTool({
      name: 'request_user_input',
      label: '请求用户补充',
      description: '只有缺少无法推断且继续执行必需的信息时，暂停步骤并询问用户。',
      parameters: Type.Object({
        question: Type.String({ minLength: 1, maxLength: 1000 }),
        reason: Type.String({ minLength: 1, maxLength: 1000 }),
      }, { additionalProperties: false }),
      execute: async (_toolCallId, args) => {
        if (typeof request.pauseForInput !== 'function') {
          return toolResult({ error: '当前任务不支持请求用户补充' }, true);
        }
        const outcome = await request.pauseForInput(args);
        state.paused = true;
        return toolResult({ paused: true, question: args.question, outcome });
      },
    });

    const submitTool = defineTool({
      name: 'submit_task_result',
      label: '提交任务结果',
      description: '完成并自检当前步骤后提交结果；平台验收通过才会结束。',
      parameters: Type.Object({
        summary: Type.String({ minLength: 1, maxLength: 8000 }),
        remainingIssues: Type.Array(Type.String({ maxLength: 1000 }), { maxItems: 10 }),
      }, { additionalProperties: false }),
      execute: async (_toolCallId, args) => {
        const issues = args.remainingIssues.map((item) => String(item).trim()).filter(Boolean);
        if (issues.length > 0) {
          return toolResult({ error: `仍有未完成事项：${issues.join('；')}` }, true);
        }
        if (typeof request.validateSubmission !== 'function') {
          return toolResult({ error: 'Worker 没有提供产物验收器' }, true);
        }
        const validation = await request.validateSubmission(args.summary);
        if (!validation?.ok) {
          return toolResult({
            error: `平台校验未通过：${(validation?.issues || []).join('；') || '存在无效产物'}`,
          }, true);
        }
        state.submitted = true;
        state.result = args.summary.trim();
        state.manifest = validation.manifest || null;
        return toolResult({ ok: true, accepted: true, summary: state.result });
      },
    });

    return {
      sessionKey: `task:${runId}:${taskId}:${attempt}`,
      paths: workerPiPaths(request),
      apiKey: request.context?.model?.apiKey,
      apiBaseUrl: request.context?.model?.baseURL,
      modelName: request.context?.model?.name,
      modelContextWindow: request.context?.model?.contextWindow,
      thinkingLevel: request.thinkingLevel || 'medium',
      systemPrompt: prompt.systemPrompt,
      message: prompt.message,
      tools: [...workspaceTools, ...capabilityTools, ...(request.piTools || []), requestInputTool, ...(request.mode === 'executor' ? [submitTool] : [])],
      isCancelled: request.isCancelled,
      beforeModelRequest: ({ index }) => {
        if (request.isCancelled?.()) throw Object.assign(new Error('步骤已取消'), { code: 'EXECUTION_CANCELLED' });
        const reservation = reserveRequest(db, runId, taskId, now());
        request.emit?.(runId, 'MODEL_WORKING', index === 1
          ? `${request.agent?.name || '成员'}正在理解任务并准备执行`
          : `${request.agent?.name || '成员'}正在结合工具结果继续处理`, {
          taskId,
          agentId: request.agent?.id || null,
          iteration: index,
          engine: 'pi',
          reservation,
        });
        return reservation;
      },
      onModelRequestComplete: (event) => request.emit?.(runId, 'MODEL_REQUEST_COMPLETED', '模型请求已完成', {
        taskId,
        agentId: request.agent?.id || null,
        attempt,
        scope: 'task',
        iteration: event.index,
        durationMs: event.durationMs,
        requestChars: event.requestChars,
        estimatedInputTokens: event.estimatedInputTokens,
        estimatedOutputTokens: event.estimatedOutputTokens,
        estimatedTotalTokens: event.estimatedInputTokens + event.estimatedOutputTokens,
        finishReasons: event.finishReasons,
        toolCallCount: event.toolCallCount,
        retryCount: 0,
        providerUsage: event.providerUsage,
        engine: 'pi',
      }),
      shouldStopAfterTurn: () => state.paused || state.submitted || Boolean(request.isCancelled?.()),
      resolveResult: ({ finalContent, status }) => {
        if (status === 'cancelled') return '';
        if (state.paused) return '';
        if (request.mode === 'advisor') return finalContent;
        if (!state.submitted) throw new Error('Pi 没有通过 submit_task_result 提交任务结果');
        return state.result || finalContent;
      },
      resolveExecutionResult: (sessionResult) => ({
        status: sessionResult?.execution?.status === 'cancelled'
          ? 'cancelled'
          : state.paused ? 'waiting' : 'completed',
        paused: state.paused,
        result: state.paused ? '' : state.submitted ? state.result : undefined,
        manifest: state.manifest,
      }),
    };
  };
}
