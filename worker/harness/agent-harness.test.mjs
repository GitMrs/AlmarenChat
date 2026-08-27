import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ADVISOR_MAX_ATTEMPTS, ADVISOR_TOOL_ITERATIONS, EXECUTOR_MAX_ATTEMPTS, EXECUTOR_TOOL_ITERATIONS, runAdvisorHarness, runExecutorHarness } from './agent-harness.mjs';
import { ADVISOR_MODEL_REQUEST_LIMIT, EXECUTOR_MODEL_REQUEST_LIMIT } from '../../lib/task-execution-plan.mjs';
import { executeWorkspaceTool } from '../../lib/agent-runtime/runtime-tools.mjs';

const run = { id: 'run-1', input: '完成页面' };
const task = {
  id: 'task-1',
  title: '实现页面',
  instruction: '创建 index.html',
  acceptanceCriteria: 'index.html 可以直接打开，且页面包含明确的提交按钮。',
};
const agent = { id: 'frontend', name: '前端', systemPrompt: '你是前端工程师。' };
const context = {
  model: {},
  space: { instructions: '输出使用中文' },
  researchContext: '',
  projectMemory: '',
  touchedPaths: new Set(),
};

test('executor model budget includes headroom beyond the tool loop', () => {
  assert.ok(EXECUTOR_MODEL_REQUEST_LIMIT >= EXECUTOR_TOOL_ITERATIONS + 2);
  assert.ok(ADVISOR_MODEL_REQUEST_LIMIT >= ADVISOR_TOOL_ITERATIONS + 2);
});

test('executor and advisor allow three attempts for empty model responses', () => {
  assert.equal(EXECUTOR_MAX_ATTEMPTS, 3);
  assert.equal(ADVISOR_MAX_ATTEMPTS, 3);
});

test('executor harness supports deterministic fake execution', async () => {
  const result = await runExecutorHarness({
    run, task, agent, context, previousResults: [], baselinePaths: new Set(), fakeMode: true,
  });
  assert.equal(result.paused, false);
  assert.match(result.result, /前端已完成/);
});

test('executor harness owns prompts and the model tool loop', async () => {
  let request = null;
  const events = [];
  const result = await runExecutorHarness({
    run,
    task: {
      ...task,
      previousAttemptReport: '第一版已经创建页面，但缺少提交按钮。',
      reviewFeedback: '保留现有布局，补充提交按钮并校验表单。',
    },
    agent,
    context: { ...context, touchedPaths: new Set() },
    previousResults: [{ title: '产品规则', result: '按钮需要清晰' }],
    baselinePaths: new Set(),
    fakeMode: false,
    taskTimeoutMs: 30_000,
    completeMessage: async (_model, messages, tools, options) => {
      request = { messages, tools, options };
      return {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'submit-1',
          type: 'function',
          function: {
            name: 'submit_task_result',
            arguments: JSON.stringify({ summary: '页面已经完成。', remainingIssues: [] }),
          },
        }],
      };
    },
    emit: (...args) => events.push(args),
    isCancelled: () => false,
    pauseForInput: () => ({ pause: true }),
    registerWorkspaceFile: async () => {},
    validateSubmission: async () => ({ ok: true, manifest: { validation: { valid: true } } }),
    workspaceOptions: {},
  });
  assert.equal(result.result, '页面已经完成。');
  assert.match(request.messages[1].content, /产品规则/);
  assert.match(request.messages[1].content, /本步骤验收标准（仅对当前步骤负责）/);
  assert.match(request.messages[1].content, /index\.html 可以直接打开/);
  assert.match(request.messages[1].content, /上一次提交摘要/);
  assert.match(request.messages[1].content, /第一版已经创建页面，但缺少提交按钮/);
  assert.match(request.messages[1].content, /本次返工要求（必须处理）/);
  assert.match(request.messages[1].content, /保留现有布局，补充提交按钮并校验表单/);
  assert.match(request.messages[0].content, /总目标只用于理解背景/);
  assert.ok(request.tools.some((tool) => tool.function.name === 'request_user_input'));
  assert.ok(request.tools.some((tool) => tool.function.name === 'submit_task_result'));
  assert.equal('maxTokens' in request.options, false);
  assert.equal('omitMaxTokens' in request.options, false);
  assert.equal(events.some((event) => event[1] === 'MODEL_WORKING'), true);
});

test('executor exposes executable Skill tools only inside the approved capability boundary', async () => {
  const executableTask = {
    ...task,
    skillId: 'csv-business-analysis',
    skillSnapshot: {
      id: 'csv-business-analysis',
      name: 'CSV 业务数据分析',
      version: '1.0.0',
      allowedTools: ['list_files', 'read_file', 'check_files', 'run_skill'],
      artifactExtensions: ['.md', '.html'],
      requiredArtifactExtensions: ['.md', '.html'],
      instructions: '调用固定入口生成报告。',
      execution: {
        entrypoint: 'analyze',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['input', 'markdownOutput', 'htmlOutput'],
          properties: {
            input: { type: 'string' },
            markdownOutput: { type: 'string' },
            htmlOutput: { type: 'string' },
          },
        },
      },
    },
  };
  const observed = [];
  const execute = (capabilities) => runExecutorHarness({
    run: { ...run, runtimeVersion: 3 },
    task: executableTask,
    agent,
    context: { ...context, authorization: { capabilities, networkPolicy: 'forbidden' }, touchedPaths: new Set() },
    previousResults: [],
    baselinePaths: new Set(),
    fakeMode: false,
    taskTimeoutMs: 30_000,
    completeMessage: async (_model, _messages, tools) => {
      observed.push(tools.map((tool) => tool.function.name));
      return {
        content: null,
        tool_calls: [{
          id: 'submit-capability-check',
          type: 'function',
          function: {
            name: 'submit_task_result',
            arguments: JSON.stringify({ summary: '权限边界已验证。', remainingIssues: [] }),
          },
        }],
      };
    },
    emit: () => {},
    isCancelled: () => false,
    pauseForInput: () => ({ pause: true }),
    registerWorkspaceFile: async () => {},
    validateSubmission: async () => ({ ok: true, manifest: { validation: { valid: true } } }),
    workspaceOptions: {},
  });

  await execute(['workspace_read', 'workspace_write']);
  await execute(['workspace_read', 'workspace_write', 'code_execute']);
  assert.equal(observed[0].includes('run_skill'), false);
  assert.equal(observed[1].includes('run_skill'), true);
});

test('executor retries two empty reasoning responses before accepting the third response', async () => {
  let requests = 0;
  const events = [];
  const result = await runExecutorHarness({
    run,
    task,
    agent,
    context: { ...context, touchedPaths: new Set() },
    previousResults: [],
    baselinePaths: new Set(),
    fakeMode: false,
    taskTimeoutMs: 30_000,
    completeMessage: async () => {
      requests += 1;
      if (requests < 3) {
        return { content: '', diagnostics: { reasoningContentChars: 4_000, finishReasons: ['length'] } };
      }
      return {
        content: null,
        tool_calls: [{
          id: 'submit-1',
          type: 'function',
          function: {
            name: 'submit_task_result',
            arguments: JSON.stringify({ summary: '第三次返回有效结果。', remainingIssues: [] }),
          },
        }],
      };
    },
    emit: (...args) => events.push(args),
    isCancelled: () => false,
    pauseForInput: () => ({ pause: true }),
    registerWorkspaceFile: async () => {},
    validateSubmission: async () => ({ ok: true, manifest: { validation: { valid: true } } }),
    workspaceOptions: {},
  });
  assert.equal(requests, 3);
  assert.equal(result.result, '第三次返回有效结果。');
  assert.equal(events.filter((event) => event[1] === 'MODEL_EMPTY_RESPONSE_RETRYING').length, 2);
});

test('executor keeps validation failures in the same tool loop', async () => {
  let requests = 0;
  let validations = 0;
  const result = await runExecutorHarness({
    run,
    task,
    agent,
    context: { ...context, touchedPaths: new Set() },
    previousResults: [],
    baselinePaths: new Set(),
    fakeMode: false,
    taskTimeoutMs: 30_000,
    completeMessage: async (_model, messages) => {
      requests += 1;
      if (requests === 2) assert.match(messages.at(-1).content, /平台校验未通过/);
      return {
        content: null,
        tool_calls: [{
          id: `submit-${requests}`,
          type: 'function',
          function: {
            name: 'submit_task_result',
            arguments: JSON.stringify({ summary: '页面已经完成。', remainingIssues: [] }),
          },
        }],
      };
    },
    emit: () => {},
    isCancelled: () => false,
    pauseForInput: () => ({ pause: true }),
    registerWorkspaceFile: async () => {},
    validateSubmission: async () => {
      validations += 1;
      return validations === 1
        ? { ok: false, issues: ['index.html 内联脚本语法无效'] }
        : { ok: true, manifest: { validation: { valid: true } } };
    },
    workspaceOptions: {},
  });
  assert.equal(requests, 2);
  assert.equal(validations, 2);
  assert.equal(result.result, '页面已经完成。');
});

test('executor repairs a rejected workspace artifact in the same attempt', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'executor-repair-'));
  const workspaceOptions = {
    projectRoot,
    userId: 'user-1',
    spaceId: 'space-1',
    taskId: 'task-1',
    attempt: 1,
  };
  let requests = 0;
  let validations = 0;
  try {
    const result = await runExecutorHarness({
      run,
      task,
      agent,
      context: { ...context, touchedPaths: new Set() },
      previousResults: [],
      baselinePaths: new Set(),
      fakeMode: false,
      taskTimeoutMs: 30_000,
      completeMessage: async (_model, messages) => {
        requests += 1;
        if (requests === 1) {
          return {
            content: null,
            tool_calls: [{
              id: 'write-invalid',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: JSON.stringify({ path: 'result.json', content: '{"done": }' }),
              },
            }],
          };
        }
        if (requests === 2 || requests === 4) {
          return {
            content: null,
            tool_calls: [{
              id: `submit-${requests}`,
              type: 'function',
              function: {
                name: 'submit_task_result',
                arguments: JSON.stringify({ summary: '产物已完成并通过检查。', remainingIssues: [] }),
              },
            }],
          };
        }
        assert.match(messages.at(-1).content, /JSON 无效/);
        return {
          content: null,
          tool_calls: [{
            id: 'repair-json',
            type: 'function',
            function: {
              name: 'patch_file',
              arguments: JSON.stringify({ path: 'result.json', search: '"done": ', replacement: '"done": true' }),
            },
          }],
        };
      },
      emit: () => {},
      isCancelled: () => false,
      pauseForInput: () => ({ pause: true }),
      registerWorkspaceFile: async () => {},
      validateSubmission: async () => {
        validations += 1;
        const check = await executeWorkspaceTool(workspaceOptions, 'check_files', { paths: ['result.json'] });
        return check.valid
          ? { ok: true, manifest: { validation: { valid: true } } }
          : { ok: false, issues: check.files.flatMap((file) => file.issues) };
      },
      workspaceOptions,
    });
    assert.equal(requests, 4);
    assert.equal(validations, 2);
    assert.equal(result.result, '产物已完成并通过检查。');
    const repaired = await executeWorkspaceTool(workspaceOptions, 'read_file', { path: 'result.json' });
    assert.deepEqual(JSON.parse(repaired.content), { done: true });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('read-only advisor can inspect the workspace but cannot mutate it', async () => {
  let toolNames = [];
  const result = await runAdvisorHarness({
    run,
    task,
    agent,
    context,
    previousResults: [],
    fakeMode: false,
    completeMessage: async (_model, messages, tools) => {
      toolNames = tools.map((tool) => tool.function.name);
      assert.match(messages[0].content, /只读工具/);
      assert.match(messages[0].content, /提交前必须逐条自检/);
      assert.match(messages[1].content, /本步骤验收标准（仅对当前步骤负责）/);
      assert.match(messages[1].content, /index\.html 可以直接打开/);
      return { content: '建议先确认验收标准。' };
    },
    isCancelled: () => false,
    taskTimeoutMs: 30_000,
    workspaceWriteAllowed: false,
    baselinePaths: new Set(),
    workspaceOptions: {},
  });
  assert.deepEqual(toolNames.sort(), ['check_files', 'list_files', 'read_file']);
  assert.equal(result, '建议先确认验收标准。');
});

test('authorized advisor can create a staged workspace artifact', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'advisor-harness-'));
  const registered = [];
  let requestCount = 0;
  try {
    const result = await runAdvisorHarness({
      run,
      task: { ...task, instruction: '把规则写入 docs/spec.md' },
      agent,
      context: { ...context, touchedPaths: new Set() },
      previousResults: [],
      fakeMode: false,
      completeMessage: async () => {
        requestCount += 1;
        return requestCount === 1
          ? {
              content: null,
              tool_calls: [{
                id: 'call-1',
                type: 'function',
                function: {
                  name: 'write_file',
                  arguments: JSON.stringify({ path: 'docs/spec.md', content: '# 产品规则\n\n状态必须明确。' }),
                },
              }],
            }
          : { content: '产品规则文档已经创建。' };
      },
      isCancelled: () => false,
      taskTimeoutMs: 30_000,
      workspaceWriteAllowed: true,
      baselinePaths: new Set(),
      workspaceOptions: {
        projectRoot,
        userId: 'user-1',
        spaceId: 'space-1',
        taskId: 'task-1',
        attempt: 1,
      },
      registerWorkspaceFile: async (relativePath) => registered.push(relativePath),
    });
    assert.equal(result, '产品规则文档已经创建。');
    assert.deepEqual(registered, ['docs/spec.md']);
    assert.match(
      await readFile(path.join(projectRoot, 'data/spaces/user-1/space-1/staging/task-1/1/workspace/docs/spec.md'), 'utf8'),
      /状态必须明确/
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('advisor retries empty reasoning responses within its three-request budget', async () => {
  const requests = [];
  const events = [];
  const result = await runAdvisorHarness({
    run,
    task,
    agent,
    context,
    previousResults: [],
    fakeMode: false,
    completeMessage: async (_model, messages, tools, options) => {
      requests.push({ messages: [...messages], tools, options });
      if (requests.length < ADVISOR_MAX_ATTEMPTS) {
        return {
          content: null,
          diagnostics: { reasoningContentChars: 4_128, finishReasons: ['length'] },
        };
      }
      return { content: '规则已经明确。' };
    },
    isCancelled: () => false,
    emit: (...args) => events.push(args),
    taskTimeoutMs: 30_000,
    workspaceWriteAllowed: false,
    baselinePaths: new Set(),
    workspaceOptions: {},
  });
  assert.equal(result, '规则已经明确。');
  assert.equal(requests.length, ADVISOR_MAX_ATTEMPTS);
  assert.equal(requests.every((request) => !('omitMaxTokens' in request.options)), true);
  assert.equal(requests.every((request) => !('maxTokens' in request.options)), true);
  assert.match(requests[1].messages.at(-1).content, /停止扩展分析/);
  assert.equal(events.filter((event) => event[1] === 'MODEL_EMPTY_RESPONSE_RETRYING').length, ADVISOR_MAX_ATTEMPTS - 1);
});
