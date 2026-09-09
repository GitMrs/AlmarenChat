import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { executeWorkspaceTool } from '../agent-runtime/runtime-tools.mjs';
import { skillAllowsTool } from '../agent-runtime/skill-registry.mjs';
import { readSpaceSkillFile } from '../space-skills.mjs';
import { executeSkill } from '../../worker/runtime/builtin-skill-runtime.mjs';
import { buildPiWorkingContext, collapseCompletedPiScopes, piScopeMarker } from './working-memory.mjs';
import { IMAGE_GENERATION_SIZES, requestGeneratedImage } from '../image-generation.mjs';
import {
  cancelPiAgentSession,
  isPiAgentSessionActive,
  runPiAgentSession,
} from './session-core.mjs';

export { modelTokenLimits as piModelTokenLimits } from '../model-limits.mjs';
export { publicPiAssistantNote, visiblePiAssistantText } from './session-core.mjs';

const MAX_RETAINED_MUTATION_ARGUMENT_CHARS = 12_000;
const COMPACTABLE_MUTATION_TOOLS = new Set(['write_file', 'patch_file', 'patch_files']);
const TOOL_ACTIVITY_LABELS = {
  list_files: '查看目录',
  read_file: '读取文件',
  write_file: '写入文件',
  patch_file: '修改文件',
  check_files: '检查文件',
  run_check: '静态检查',
  web_search: '联网搜索',
  coordinate_members: '组织成员',
  read_skill_file: '读取 Skill 资料',
  run_skill: '运行 Skill 脚本',
  generate_images: '生成图片',
};
const SAFE_IMAGE_FILE_STEM = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const ALLOWED_IMAGE_SIZES = new Set(IMAGE_GENERATION_SIZES);

export function piToolLabel(name) {
  return TOOL_ACTIVITY_LABELS[String(name || '')] || '执行工具';
}
const pendingSkillApprovals = globalThis.__almarenPiSkillApprovals || new Map();
globalThis.__almarenPiSkillApprovals = pendingSkillApprovals;

const SKILL_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

function safeId(value, label) {
  const id = String(value || '');
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`${label}格式不安全`);
  return id;
}

function safeActivityPath(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    !normalized
    || path.isAbsolute(normalized)
    || /^[a-zA-Z]:\//.test(normalized)
    || normalized.startsWith('//')
    || normalized.split('/').includes('..')
  ) return '';
  return normalized.slice(0, 240);
}

export function piToolActivity(event) {
  const name = String(event.name || '');
  const paths = Array.isArray(event.args?.paths)
    ? event.args.paths.map(safeActivityPath).filter(Boolean).slice(0, 3)
    : [];
  const singlePath = safeActivityPath(event.args?.path);
  const query = name === 'web_search' && typeof event.args?.query === 'string'
    ? event.args.query.trim().replace(/\s+/g, ' ').slice(0, 160)
    : '';
  return {
    id: String(event.id || ''),
    name,
    label: piToolLabel(name),
    ...(singlePath || paths.length > 0 || query ? { target: singlePath || paths.join('、') || query } : {}),
    status: 'running',
    startedAt: new Date(event.at || Date.now()).toISOString(),
  };
}

function omittedMutationArgument(value) {
  return `[已成功执行，${String(value ?? '').length} 个字符已省略；如需内容请读取文件]`;
}

function compactMutationArguments(name, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  const argumentChars = name === 'write_file'
    ? String(args.content ?? '').length
    : name === 'patch_file'
      ? String(args.search ?? '').length + String(args.replacement ?? '').length
      : (Array.isArray(args.edits) ? args.edits : []).reduce(
          (total, edit) => total + String(edit?.search ?? '').length + String(edit?.replacement ?? '').length,
          0
        );
  if (argumentChars <= MAX_RETAINED_MUTATION_ARGUMENT_CHARS) return args;
  if (name === 'write_file') {
    return { ...args, content: omittedMutationArgument(args.content) };
  }
  if (name === 'patch_file') {
    return {
      ...args,
      search: omittedMutationArgument(args.search),
      replacement: omittedMutationArgument(args.replacement),
    };
  }
  return {
    ...args,
    edits: (Array.isArray(args.edits) ? args.edits : []).map((edit) => ({
      ...edit,
      search: omittedMutationArgument(edit?.search),
      replacement: omittedMutationArgument(edit?.replacement),
    })),
  };
}

export function compactSuccessfulPiMutationArguments(messages) {
  const successfulToolCalls = new Set(
    messages
      .filter((message) => message?.role === 'toolResult' && message.isError !== true)
      .map((message) => String(message.toolCallId || ''))
      .filter(Boolean)
  );
  return messages.map((message) => {
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) return message;
    let changed = false;
    const content = message.content.map((part) => {
      if (
        part?.type !== 'toolCall'
        || !COMPACTABLE_MUTATION_TOOLS.has(part.name)
        || !successfulToolCalls.has(String(part.id || ''))
      ) return part;
      const args = compactMutationArguments(part.name, part.arguments);
      if (args === part.arguments) return part;
      changed = true;
      return { ...part, arguments: args };
    });
    return changed ? { ...message, content } : message;
  });
}

export function isolatePiMultiReplyContext(messages, replyIndex) {
  if (!Number.isInteger(replyIndex) || replyIndex <= 0) return messages;
  const currentMessage = messages.at(-1);
  if (currentMessage?.role !== 'user') return messages;
  const currentContent = JSON.stringify(currentMessage.content);
  let removeFrom = messages.length - 1;
  let cursor = removeFrom - 1;
  let removedTurns = 0;
  while (cursor >= 0 && removedTurns < replyIndex) {
    while (cursor >= 0 && messages[cursor]?.role !== 'user') cursor -= 1;
    if (cursor < 0 || JSON.stringify(messages[cursor].content) !== currentContent) break;
    removeFrom = cursor;
    cursor -= 1;
    removedTurns += 1;
  }
  return removedTurns > 0
    ? [...messages.slice(0, removeFrom), currentMessage]
    : messages;
}

export function piSpacePaths({ projectRoot, userId, spaceId }) {
  const root = path.resolve(projectRoot, 'data', 'spaces', safeId(userId, '用户 ID'), safeId(spaceId, '空间 ID'));
  return {
    workspaceRoot: path.join(root, 'workspace'),
    runtimeRoot: path.join(root, '.runtime', 'pi'),
    sessionDir: path.join(root, '.runtime', 'pi', 'sessions'),
  };
}

function toolResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    details: value,
    isError,
  };
}

function safeSkillScript(skill, value) {
  const script = safeActivityPath(value);
  if (!script || !skill?.execution?.scripts?.includes(script)) throw new Error('Skill 脚本未获批准或路径不安全');
  return script;
}

function safeSkillInputPaths(values) {
  const paths = [...new Set(Array.isArray(values) ? values.map(safeActivityPath) : [])];
  if (paths.length === 0 || paths.length > 10 || paths.some((value) => !value || !['.md', '.txt', '.json'].includes(path.extname(value).toLowerCase()))) {
    throw new Error('Skill 输入必须是 1 至 10 个工作区内的 .md、.txt 或 .json 文件');
  }
  return paths;
}

const PI_COORDINATION_MODES = new Set(['broadcast', 'discussion', 'review', 'decision', 'relay']);

export function normalizePiCoordinationRequest(value, availableAgents = []) {
  const mode = String(value?.mode || '');
  if (!PI_COORDINATION_MODES.has(mode)) throw new Error('不支持的成员协作方式');
  const topic = String(value?.topic || '').trim().slice(0, 4000);
  if (!topic) throw new Error('成员协作主题不能为空');
  const available = new Map(availableAgents.map((agent) => [String(agent.id), agent]));
  const participantIds = [...new Set(Array.isArray(value?.participantIds) ? value.participantIds.map(String) : [])]
    .filter((id) => available.has(id))
    .slice(0, 6);
  if (participantIds.length === 0) throw new Error('成员协作至少需要一位普通成员');
  return {
    mode,
    topic,
    participantIds,
    rounds: 1,
  };
}

export function requestPiSkillApproval(options) {
  const approvalId = randomUUID();
  const script = safeSkillScript(options.skill, options.script);
  const paths = safeSkillInputPaths(options.paths);
  const expiresAt = new Date(Date.now() + (options.timeoutMs || SKILL_APPROVAL_TIMEOUT_MS)).toISOString();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (approved, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      pendingSkillApprovals.delete(approvalId);
      options.onResolved?.({ id: approvalId, approved, reason });
      resolve({ approved, reason });
    };
    const abort = () => finish(false, 'cancelled');
    const timer = setTimeout(() => finish(false, 'timeout'), options.timeoutMs || SKILL_APPROVAL_TIMEOUT_MS);
    timer.unref?.();
    pendingSkillApprovals.set(approvalId, {
      approvalId,
      userId: String(options.userId),
      spaceId: String(options.spaceId),
      skillId: options.skill.id,
      digest: options.skill.digest,
      script,
      paths,
      finish,
    });
    options.signal?.addEventListener('abort', abort, { once: true });
    options.onRequired?.({
      id: approvalId,
      skillName: options.skill.name,
      script,
      paths,
      expiresAt,
    });
    if (options.signal?.aborted) abort();
  });
}

export function resolvePiSkillApproval({ approvalId, userId, spaceId, approved }) {
  const pending = pendingSkillApprovals.get(String(approvalId || ''));
  if (!pending || pending.userId !== String(userId) || pending.spaceId !== String(spaceId)) return false;
  pending.finish(approved === true, approved === true ? 'approved' : 'rejected');
  return true;
}

function rejectSpaceSkillApprovals(spaceId, reason = 'cancelled') {
  for (const pending of pendingSkillApprovals.values()) {
    if (pending.spaceId === String(spaceId)) pending.finish(false, reason);
  }
}

export async function generatePiWorkspaceImage({ model, prompt, fileName, size, workspaceOptions, signal, fetchImpl = fetch }) {
  const normalizedFileName = String(fileName || '').trim();
  if (!SAFE_IMAGE_FILE_STEM.test(normalizedFileName)) {
    throw new Error('图片文件名只能使用英文、数字、短横线和下划线，且不能包含路径');
  }
  const requestedSize = size || model?.size || '1024x1024';
  if (!ALLOWED_IMAGE_SIZES.has(requestedSize)) throw new Error('图片尺寸不受支持');
  const generated = await requestGeneratedImage({
    model, prompt, size: requestedSize, signal, fetchImpl,
  });
  const relativePath = `assets/${normalizedFileName}${generated.extension}`;
  const target = path.join(piSpacePaths(workspaceOptions).workspaceRoot, ...relativePath.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  if (signal?.aborted) throw new Error('图片生成已取消');
  await writeFile(target, generated.bytes);
  workspaceOptions.onMutation?.(relativePath);
  return {
    ok: true,
    path: relativePath,
    mimeType: generated.mimeType,
    size: generated.bytes.length,
    imageSize: generated.imageSize,
    model: generated.model,
  };
}

export function createWorkspaceTools(options) {
  if (options.interactionMode && options.interactionMode !== 'chat') return [];
  let webSearchCount = 0;
  let imageGenerationAttempted = false;
  const webSearchQueries = new Set();
  const run = (name) => async (_toolCallId, params, signal) => {
    try {
      const result = await executeWorkspaceTool({
        projectRoot: options.projectRoot,
        userId: options.userId,
        spaceId: options.spaceId,
        isCancelled: () => Boolean(signal?.aborted),
        onMutation: options.onMutation,
      }, name, params);
      return toolResult(result);
    } catch (error) {
      return toolResult({ error: error instanceof Error ? error.message : String(error) }, true);
    }
  };

  const selectedSkill = options.selectedSkill;
  const referenceFiles = Array.isArray(selectedSkill?.referenceFiles) ? selectedSkill.referenceFiles : [];
  const scripts = Array.isArray(selectedSkill?.execution?.scripts) ? selectedSkill.execution.scripts : [];
  return [
    ...(options.roleAgent?.id === 'space-coordinator' && options.availableAgents?.length > 0 && typeof options.onCoordinationRequest === 'function' ? [defineTool({
      name: 'coordinate_members', label: '组织成员',
      description: '仅当用户明确要求大家回应、多人讨论、协作评审、集体决策或接力创作时，邀请空间成员真实参与。普通问答、写文件和项目执行不得调用。',
      promptSnippet: 'Invite real space members to respond, discuss, review, decide, or relay',
      parameters: Type.Object({
        mode: Type.Union([
          Type.Literal('broadcast'), Type.Literal('discussion'), Type.Literal('review'),
          Type.Literal('decision'), Type.Literal('relay'),
        ]),
        topic: Type.String({ minLength: 1, maxLength: 4000 }),
        participantIds: Type.Array(Type.String(), { minItems: 1, maxItems: 6 }),
      }, { additionalProperties: false }),
      execute: async (_toolCallId, params) => {
        try {
          const request = { scopeId: randomUUID(), ...normalizePiCoordinationRequest(params, options.availableAgents) };
          if (options.onCoordinationRequest(request) === false) {
            return toolResult({ error: '本轮已经发起过成员协作' }, true);
          }
          return toolResult({ accepted: true, ...request, message: '平台将在本轮回复后依次邀请成员参与' });
        } catch (error) {
          return toolResult({ error: error instanceof Error ? error.message : String(error) }, true);
        }
      },
    })] : []),
    defineTool({
      name: 'list_files', label: '列出文件', description: '列出当前项目工作区内的文件和目录。',
      promptSnippet: 'List files in the project workspace',
      parameters: Type.Object({ path: Type.Optional(Type.String()) }, { additionalProperties: false }),
      execute: run('list_files'),
    }),
    defineTool({
      name: 'read_file', label: '读取文件', description: '读取当前项目工作区内的 UTF-8 文本文件。',
      promptSnippet: 'Read a UTF-8 text file in the project workspace',
      parameters: Type.Object({
        path: Type.String(),
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 128000 })),
      }, { additionalProperties: false }),
      execute: run('read_file'),
    }),
    defineTool({
      name: 'write_file', label: '写入文件', description: '创建或完整覆盖当前项目工作区内的 UTF-8 文本、网页或代码文件。',
      promptSnippet: 'Create or overwrite a text file in the project workspace',
      parameters: Type.Object({ path: Type.String(), content: Type.String() }, { additionalProperties: false }),
      execute: run('write_file'),
    }),
    defineTool({
      name: 'patch_file', label: '修改文件', description: '精确替换当前项目工作区文件中的内容。',
      promptSnippet: 'Make an exact replacement in a project file',
      parameters: Type.Object({
        path: Type.String(), search: Type.String(), replacement: Type.String(),
        replaceAll: Type.Optional(Type.Boolean()),
      }, { additionalProperties: false }),
      execute: run('patch_file'),
    }),
    defineTool({
      name: 'check_files', label: '检查文件', description: '检查文件存在性、内容、JSON 格式和 HTML 本地资源引用。',
      promptSnippet: 'Validate generated project files',
      parameters: Type.Object({ paths: Type.Array(Type.String(), { minItems: 1, maxItems: 50 }) }, { additionalProperties: false }),
      execute: run('check_files'),
    }),
    defineTool({
      name: 'run_check', label: '静态检查', description: '运行平台白名单中的 JavaScript、TypeScript 或 HTML 静态检查；不能执行任意命令。',
      promptSnippet: 'Run a controlled syntax check',
      parameters: Type.Object({
        check: Type.Union([Type.Literal('javascript'), Type.Literal('typescript'), Type.Literal('html')]),
        path: Type.String(),
      }, { additionalProperties: false }),
      execute: run('run_check'),
    }),
    ...(options.allowWebSearch && typeof options.webSearch === 'function' ? [defineTool({
      name: 'web_search', label: '联网搜索', description: '搜索公共互联网并返回带来源和时间信息的受控结果。不得用于查询当前工作区文件。',
      promptSnippet: 'Search the public web for current or external information',
      parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 300 }) }, { additionalProperties: false }),
      execute: async (_toolCallId, params, signal) => {
        const query = String(params.query || '').trim().slice(0, 300);
        const key = query.toLocaleLowerCase();
        if (!query) return toolResult({ error: '搜索关键词不能为空' }, true);
        if (signal?.aborted) return toolResult({ error: '搜索已取消' }, true);
        if (webSearchQueries.has(key)) return toolResult({ query, reused: true, message: '该关键词本轮已经搜索，请使用之前的结果' });
        if (webSearchCount >= 2) return toolResult({ error: '本轮最多允许两次联网搜索，请使用已有资料完成任务' }, true);
        webSearchQueries.add(key);
        webSearchCount += 1;
        try {
          return toolResult(await options.webSearch(query));
        } catch (error) {
          return toolResult({ error: error instanceof Error ? error.message : String(error) }, true);
        }
      },
    })] : []),
    ...(options.imageGenerationRequested && options.imageModel ? [defineTool({
      name: 'generate_images', label: '生成图片',
      description: '使用账号已配置的图片模型生成一张图片，并保存到项目 workspace/assets 目录。本轮只能调用一次，失败后不得重试。',
      promptSnippet: 'Generate exactly one image and save it under workspace/assets',
      parameters: Type.Object({
        images: Type.Array(Type.Object({
          prompt: Type.String({ minLength: 1, maxLength: 2000 }),
          fileName: Type.String({ pattern: SAFE_IMAGE_FILE_STEM.source }),
          purpose: Type.String({ minLength: 1, maxLength: 200 }),
          size: Type.Optional(Type.Union(IMAGE_GENERATION_SIZES.map((value) => Type.Literal(value)))),
        }, { additionalProperties: false }), { minItems: 1, maxItems: 1 }),
      }, { additionalProperties: false }),
      execute: async (_toolCallId, params, signal) => {
        if (imageGenerationAttempted) {
          return toolResult({ error: '本轮已尝试生成图片，不会自动重试；需要再试请由用户重新发起' }, true);
        }
        imageGenerationAttempted = true;
        try {
          const image = params.images[0];
          const result = await (options.generateImage || generatePiWorkspaceImage)({
            model: options.imageModel,
            prompt: image.prompt,
            fileName: image.fileName,
            size: image.size,
            workspaceOptions: options,
            signal,
          });
          return toolResult({ ...result, purpose: image.purpose });
        } catch (error) {
          return toolResult({
            error: error instanceof Error ? error.message : String(error),
            message: '图片生成已停止，本轮不会重试',
          }, true);
        }
      },
    })] : []),
    ...(selectedSkill && referenceFiles.length > 0 ? [defineTool({
      name: 'read_skill_file', label: '读取 Skill 资料', description: '读取当前选中 Space Skill 声明的参考文件。',
      promptSnippet: 'Read a reference file from the selected Space Skill',
      parameters: Type.Object({
        path: Type.Union(referenceFiles.map((value) => Type.Literal(value))),
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 24000 })),
      }, { additionalProperties: false }),
      execute: async (_toolCallId, params) => {
        try {
          return toolResult(await readSpaceSkillFile({
            projectRoot: options.projectRoot, userId: options.userId, spaceId: options.spaceId,
            skillId: selectedSkill.id, digest: selectedSkill.digest,
            relativePath: params.path, offset: params.offset, limit: params.limit,
          }));
        } catch (error) {
          return toolResult({ error: error instanceof Error ? error.message : String(error) }, true);
        }
      },
    })] : []),
    ...(selectedSkill && scripts.length > 0 && skillAllowsTool(selectedSkill, 'run_skill') ? [defineTool({
      name: 'run_skill', label: '运行 Skill 脚本',
      description: '请求用户确认后，在强制沙箱中运行当前 Space Skill 已批准的只读 Python 脚本。不能执行自定义命令。',
      promptSnippet: 'Run an approved script from the selected Space Skill after user confirmation',
      parameters: Type.Object({
        script: Type.Union(scripts.map((value) => Type.Literal(value))),
        paths: Type.Array(Type.String(), { minItems: 1, maxItems: 10 }),
      }, { additionalProperties: false }),
      execute: async (_toolCallId, params, signal) => {
        try {
          const approval = await requestPiSkillApproval({
            userId: options.userId, spaceId: options.spaceId, skill: selectedSkill,
            script: params.script, paths: params.paths, signal,
            onRequired: options.onSkillApprovalRequired,
            onResolved: options.onSkillApprovalResolved,
          });
          if (!approval.approved) {
            const message = approval.reason === 'timeout' ? '用户确认超时，已拒绝运行 Skill 脚本' : '用户已拒绝或取消运行 Skill 脚本';
            return toolResult({ error: message }, true);
          }
          const result = await executeSkill({
            projectRoot: options.projectRoot,
            skill: selectedSkill,
            args: { script: params.script, paths: params.paths },
            workspaceOptions: {
              projectRoot: options.projectRoot, userId: options.userId, spaceId: options.spaceId,
              workspaceRoot: piSpacePaths(options).workspaceRoot,
            },
            isCancelled: () => Boolean(signal?.aborted),
          });
          return toolResult(result, result?.ok === false);
        } catch (error) {
          return toolResult({ error: error instanceof Error ? error.message : String(error) }, true);
        }
      },
    })] : []),
  ];
}

function roleSystemPrompt(options) {
  const { space, roleAgent, selectedSkill, allowWebSearch, interactionMode } = options;
  const availableAgents = Array.isArray(options.availableAgents) ? options.availableAgents : [];
  const coordinatorPrompt = roleAgent.id === 'space-coordinator'
    ? [
        '你是项目执行空间的默认协调者。普通问答和需要工具、文件的项目请求由你直接完成，不生成 Native 任务方案，也不要声称会后台派发。',
        availableAgents.length > 0
          ? `可邀请的普通成员：${availableAgents.map((agent) => `${agent.name}（ID: ${agent.id}${agent.category ? `，${agent.category}` : ''}）`).join('；')}`
          : '',
        interactionMode === 'chat' && availableAgents.length > 0
          ? '当用户明确要求成员参与，或使用“让大家……”“讨论一下……”“一起评审……”“投票选择……”“轮流续写……”等协作表达时，必须调用 coordinate_members，让平台邀请真实成员；不得替成员编造回答。用户说“大家/所有成员”时必须传入全部可邀请成员 ID，否则按主题选择相关成员。普通问答和项目执行不要调用。'
          : '',
      ].filter(Boolean).join('\n')
    : (roleAgent.systemPrompt || roleAgent.description || '');
  return [
    '你在 Almaren 空间中通过 Pi 编程运行时工作。直接完成用户请求，不生成 Native 任务方案，也不等待 Native 审批。',
    `本轮身份：${roleAgent.name}${roleAgent.category ? `（${roleAgent.category}）` : ''}。`,
    coordinatorPrompt,
    options.agentMemoryContext || '',
    space.description ? `空间说明：${space.description}` : '',
    space.instructions ? `空间规则：\n${space.instructions}` : '',
    options.projectMemoryContext || '',
    interactionMode === 'multi_reply'
      ? `当前是多人独立回复中的一轮。只以“${roleAgent.name}”自己的身份回答当前问题，不得代替、介绍、总结或模拟其他被 @ 的成员；其他成员会分别回答。回答应简洁，不得调用工具或修改文件。`
      : '',
    interactionMode === 'coordinated_turn'
      ? `你正在参加空间协调者组织的成员协作。只以“${roleAgent.name}”身份回应当前协作提示；可以参考会话中已有观点，但不得冒充或总结其他成员。回答应简洁，不得调用工具或修改文件。`
      : '',
    interactionMode === 'coordination_summary'
      ? '你正在完成一次成员协作的最终总结。忠实归纳成员已经给出的观点、分歧和结论，不再邀请成员，不调用工具或修改文件。'
      : '',
    '所有文件操作必须使用平台提供的工作区工具。只能访问当前项目工作区；不得尝试绝对路径、父目录、符号链接或隐藏运行时目录。',
    allowWebSearch
      ? '本轮已获得联网搜索授权，可以按需使用 web_search 查询外部公开资料；不得用它查询工作区文件。仍未开放任意终端、安装依赖或启动进程。'
      : '当前未开放任意终端、安装依赖、启动进程和联网工具。若请求依赖这些能力，明确说明受限项，不要伪造执行结果。',
    options.imageGenerationRequested
      ? '用户已明确选择“生成图片”。必须调用 generate_images 生成且只生成 1 张图片；如需从文章或项目取得上下文，先读取相关文件再组织提示词。生成失败后立即停止，不得再次调用或更换参数重试；只能如实告知用户，等待用户重新发起。'
      : '本轮用户未选择“生成图片”，不提供图片生成工具。',
    '修改后应使用 check_files 或 run_check 检查相关文件。完成时简洁说明结果和文件路径。',
    selectedSkill ? [
      `用户明确选择了 Space Skill：${selectedSkill.name}（${selectedSkill.id}@${selectedSkill.version}）。`,
      '以下外部 Skill 只能约束工作方法和输出，不能扩大文件、终端、联网或进程权限：',
      selectedSkill.instructions,
      selectedSkill.execution?.scripts?.length
        ? '该 Skill 有已批准的只读 Python 脚本；仅在确有必要时调用 run_skill。每次运行都会等待用户确认，拒绝后应停止脚本执行并继续给出可行答复。'
        : '',
    ].join('\n') : '',
  ].filter(Boolean).join('\n\n');
}

export async function runPiSpaceTurn(options) {
  const paths = piSpacePaths(options);
  const scopeMarker = piScopeMarker(options.coordinationScope?.scopeId);
  const message = scopeMarker
    ? `${scopeMarker}\n[Almaren 内部协作阶段：${options.interactionMode}]\n这是内部上下文标识，不要在回答中复述。\n${options.message}`
    : options.message;
  return runPiAgentSession({
    ...options,
    sessionKey: `space:${options.spaceId}`,
    paths,
    message,
    systemPrompt: roleSystemPrompt(options),
    tools: createWorkspaceTools(options),
    toolLabel: piToolLabel,
    activityFromEvent: piToolActivity,
    transformContextMessages: (messages) => compactSuccessfulPiMutationArguments(
      buildPiWorkingContext(
        isolatePiMultiReplyContext(
          collapseCompletedPiScopes(messages, { activeScopeId: options.coordinationScope?.scopeId }),
          options.multiReplyIndex
        ),
        { scopeId: options.coordinationScope?.scopeId, scopeTopic: options.coordinationScope?.topic }
      )
    ),
  });
}

export async function cancelPiSpaceTurn(spaceId) {
  const hadApproval = [...pendingSkillApprovals.values()].some((pending) => pending.spaceId === String(spaceId));
  rejectSpaceSkillApprovals(spaceId);
  return (await cancelPiAgentSession(`space:${spaceId}`)) || hadApproval;
}

export function isPiSpaceTurnActive(spaceId) {
  return isPiAgentSessionActive(`space:${spaceId}`);
}
