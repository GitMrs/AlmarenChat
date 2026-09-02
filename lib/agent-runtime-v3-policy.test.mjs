import test from 'node:test';
import assert from 'node:assert/strict';
import { COORDINATOR_ACTION_TOOL_NAME, auditGoalCoverage, authorizationAllowsCapability, authorizationRequirements, coordinatorAuthorization, coordinatorDecisionTrigger, coordinatorStateAfterDispatchRejection, coordinatorTaskReviewInstructions, coordinatorTaskReviewRequest, dispatchConstraintFromFeedback, dispatchRequiresApproval, normalizeCoordinatorAction, normalizeCoordinatorReviewAction, requestCoordinatorAction, requestCoordinatorReviewAction, structuredToolOutput } from './agent-runtime-v3-policy.mjs';

const members = [
  { id: 'product', name: '产品' },
  { id: 'frontend', name: '前端' },
];

test('structured coordinator output prefers a tool call and keeps content fallback', () => {
  const argumentsJson = JSON.stringify({ type: 'finish', summary: '完成', coverage: [] });
  assert.equal(structuredToolOutput({
    content: null,
    tool_calls: [{ function: { name: COORDINATOR_ACTION_TOOL_NAME, arguments: argumentsJson } }],
  }, COORDINATOR_ACTION_TOOL_NAME), argumentsJson);
  assert.equal(structuredToolOutput({ content: '{"type":"block"}' }, COORDINATOR_ACTION_TOOL_NAME), '{"type":"block"}');
});

test('normalizes a dynamic dispatch against the current roster', () => {
  const action = normalizeCoordinatorAction({
    type: 'dispatch',
    summary: '先实现页面',
    tasks: [{
      agentId: 'frontend', mode: 'executor', title: '实现儿童时钟',
      instruction: '创建并检查儿童时钟页面。', acceptanceCriteria: '页面可交互且文件检查通过。',
      reason: '需求明确，主要工作是页面和浏览器交互。', expectedArtifacts: ['index.html'],
      skillId: 'responsive-page-builder',
    }],
  }, {
    members,
    remainingTasks: 8,
    authorization: { capabilities: ['workspace_read', 'workspace_write'] },
  });
  assert.equal(action.tasks[0].agentName, '前端');
  assert.equal(action.tasks[0].reason, '需求明确，主要工作是页面和浏览器交互。');
  assert.equal(action.tasks[0].skillId, 'responsive-page-builder');
  assert.equal(action.tasks[0].webResearchRequired, false);
});

test('task-level research cannot exceed or contradict the run authorization', () => {
  const task = {
    agentId: 'product', mode: 'advisor', title: '核对政策',
    instruction: '联网核对最新官方政策。', acceptanceCriteria: '提供官方依据。',
    reason: '产品负责政策梳理。', webResearchRequired: true,
  };
  assert.throws(() => normalizeCoordinatorAction({ type: 'dispatch', tasks: [task] }, {
    members, remainingTasks: 8,
    authorization: { capabilities: ['workspace_read'], networkPolicy: 'forbidden' },
  }), /未授权 web_research/);

  assert.throws(() => normalizeCoordinatorAction({ type: 'dispatch', tasks: [{
    ...task,
    instruction: '只使用现有内容，不联网。',
  }] }, {
    members, remainingTasks: 8,
    authorization: { capabilities: ['workspace_read', 'web_research'], networkPolicy: 'allowed' },
  }), /明确禁止联网/);
});

test('rejects unknown members and duplicate tasks', () => {
  assert.throws(() => normalizeCoordinatorAction({
    type: 'dispatch', tasks: [{ agentId: 'missing', title: 'x', instruction: 'x', acceptanceCriteria: 'x', reason: 'x' }],
  }, { members, remainingTasks: 8 }), /不在空间/);
  assert.throws(() => normalizeCoordinatorAction({
    type: 'dispatch', tasks: [{ agentId: 'frontend', title: '实现', instruction: '创建页面', acceptanceCriteria: '完成', reason: '适合' }],
  }, { members, remainingTasks: 8, existingTasks: [{ agentId: 'frontend', title: '实现', instruction: '创建页面' }] }), /重复/);
});

test('file-producing work can use advisor mode when workspace writes are authorized', () => {
  const advisorAction = normalizeCoordinatorAction({
    type: 'dispatch',
    tasks: [{
      agentId: 'product', mode: 'advisor', title: '整理产品规则',
      instruction: '明确规则并写入 docs/ticket-list-spec.md。',
      acceptanceCriteria: '规则完整且文件可以交给前端。', reason: '产品负责定义规则。',
      expectedArtifacts: ['docs/ticket-list-spec.md'],
    }],
  }, { members, remainingTasks: 8, workspaceWriteAllowed: true });
  assert.equal(advisorAction.tasks[0].mode, 'advisor');
  assert.equal(advisorAction.tasks[0].workspaceWriteRequired, true);

  assert.throws(() => normalizeCoordinatorAction({
    type: 'dispatch',
    tasks: [{
      agentId: 'product', mode: 'advisor', title: '整理产品规则',
      instruction: '明确规则并写入 docs/ticket-list-spec.md。',
      acceptanceCriteria: '规则完整且文件可以交给前端。', reason: '产品负责定义规则。',
      expectedArtifacts: ['docs/ticket-list-spec.md'],
    }],
  }, { members, remainingTasks: 8, workspaceWriteAllowed: false }), /未授权 workspace_write/);

  const action = normalizeCoordinatorAction({
    type: 'dispatch',
    tasks: [{
      agentId: 'product', mode: 'executor', title: '整理产品规则',
      instruction: '明确规则并写入 docs/ticket-list-spec.md。',
      acceptanceCriteria: '规则完整且文件可以交给前端。', reason: '产品负责定义规则。',
      expectedArtifacts: ['docs/ticket-list-spec.md'],
    }],
  }, { members, remainingTasks: 8 });
  assert.equal(action.tasks[0].agentId, 'product');
  assert.equal(action.tasks[0].mode, 'executor');
});

test('advisor mode accepts semantic results and review does not require files', () => {
  const action = normalizeCoordinatorAction({
    type: 'dispatch',
    tasks: [{
      agentId: 'product', mode: 'advisor', title: '明确产品规则',
      instruction: '输出可供前端直接采用的状态和优先级规则。',
      acceptanceCriteria: '规则完整且没有歧义。', reason: '产品负责定义规则。',
      expectedArtifacts: ['工单状态与优先级规则'],
    }],
  }, { members, remainingTasks: 8 });
  assert.equal(action.tasks[0].mode, 'advisor');
  assert.match(coordinatorTaskReviewInstructions('advisor'), /manifest 为 null、没有工作区变更是正常状态/);
  assert.match(coordinatorTaskReviewInstructions('executor'), /文件差异和校验结果/);
});

test('coordinator reviews a submission against the task-local acceptance criteria', () => {
  const task = {
    mode: 'executor',
    title: '实现页面',
    instruction: '创建 index.html',
    acceptanceCriteria: '页面可以直接打开，并正确显示三项统计数据。',
  };
  const material = { report: '页面已完成', validation: { valid: true } };
  const request = coordinatorTaskReviewRequest('完成整个数据分析项目', task, material);

  assert.match(request, /总目标：完成整个数据分析项目/);
  assert.match(request, /本步骤验收标准（必须逐条核对）/);
  assert.match(request, /页面可以直接打开，并正确显示三项统计数据/);
  assert.match(request, /提交材料/);
  assert.equal(coordinatorTaskReviewRequest('完成整个数据分析项目', task, material), request);
});

test('coordinator review retries reasoning-only and malformed responses', async () => {
  const invalidAttempts = [];
  const action = await requestCoordinatorReviewAction(({ attempt }) => {
    if (attempt === 1) {
      return {
        coordinatorReviewResponse: true,
        output: '',
        diagnostics: { reasoningContentChars: 778, finishReasons: ['stop'] },
      };
    }
    if (attempt === 2) return 'not json';
    return { decision: 'accept', summary: '文件与规则均通过验收', feedback: '', publicNote: '产品规则已确认。' };
  }, { onInvalid: ({ attempt }) => invalidAttempts.push(attempt) });
  assert.equal(action.decision, 'accept');
  assert.deepEqual(invalidAttempts, [1, 2]);
});

test('coordinator review rejects invalid decisions after three attempts', async () => {
  assert.throws(() => normalizeCoordinatorReviewAction({ decision: 'maybe' }), /有效的验收决定/);
  await assert.rejects(
    () => requestCoordinatorReviewAction(() => ''),
    (error) => error.code === 'COORDINATOR_REVIEW_INVALID'
  );
});

test('retries one malformed coordinator response before accepting an action', async () => {
  const responses = [
    '',
    {
      type: 'dispatch',
      tasks: [{
        agentId: 'frontend', title: '实现页面', instruction: '创建 index.html',
        acceptanceCriteria: '文件可打开且交互可用', reason: '前端成员适合此任务',
      }],
    },
  ];
  const invalidAttempts = [];
  const action = await requestCoordinatorAction(
    ({ attempt }) => responses[attempt - 1],
    { members, remainingTasks: 8 },
    { onInvalid: ({ attempt }) => invalidAttempts.push(attempt) }
  );
  assert.equal(action.type, 'dispatch');
  assert.deepEqual(invalidAttempts, [1]);
});

test('coordinator retry receives empty-response diagnostics', async () => {
  const diagnostics = { reasoningContentChars: 7_000, finishReasons: ['length'] };
  let secondRequestState = null;
  const action = await requestCoordinatorAction(({ attempt, previousDiagnostics }) => {
    if (attempt === 1) {
      return { coordinatorResponse: true, output: '', diagnostics };
    }
    secondRequestState = { previousDiagnostics };
    return {
      coordinatorResponse: true,
      output: {
        type: 'dispatch',
        tasks: [{
          agentId: 'frontend', title: '实现页面', instruction: '创建 index.html',
          acceptanceCriteria: '页面可用', reason: '前端专业匹配',
        }],
      },
      diagnostics: null,
    };
  }, { members, remainingTasks: 8 });
  assert.equal(action.type, 'dispatch');
  assert.deepEqual(secondRequestState.previousDiagnostics, diagnostics);
});

test('fails after three invalid coordinator responses and preserves diagnostics', async () => {
  let requests = 0;
  await assert.rejects(
    () => requestCoordinatorAction(() => {
      requests += 1;
      return {
        coordinatorResponse: true,
        output: '',
        diagnostics: { reasoningContentChars: requests * 100, finishReasons: ['stop'] },
      };
    }, { members, remainingTasks: 8 }),
    (error) => error.code === 'COORDINATOR_ACTION_INVALID'
      && error.diagnostics.reasoningContentChars === 300
  );
  assert.equal(requests, 3);
});

test('finish requires at least one accepted result', () => {
  assert.throws(() => normalizeCoordinatorAction({ type: 'finish', summary: '完成' }, { allowFinish: false }), /不能结束/);
  assert.equal(normalizeCoordinatorAction({ type: 'finish', summary: '完成' }, { allowFinish: true }).type, 'finish');
});

test('finish requires evidence for every authorized step and deliverable', () => {
  const requirements = ['实现页面', '交付 index.html'];
  assert.throws(() => normalizeCoordinatorAction({
    type: 'finish',
    coverage: [{ requirement: '实现页面', taskIds: ['task-1'], evidence: '页面已实现' }],
  }, {
    allowFinish: true,
    requirements,
    completedTaskIds: ['task-1'],
  }), /交付 index\.html/);

  const action = normalizeCoordinatorAction({
    type: 'finish',
    summary: '全部完成',
    coverage: [
      { requirement: '实现页面', taskIds: ['task-1'], evidence: 'task-1 已通过验收' },
      { requirement: '交付 index.html', taskIds: ['task-1'], evidence: '已生成 index.html' },
    ],
  }, {
    allowFinish: true,
    requirements,
    completedTaskIds: ['task-1'],
  });
  assert.equal(action.coverage.length, 2);
});

test('goal coverage rejects unknown or unfinished task evidence', () => {
  const authorization = { steps: ['完成设计'], deliverables: ['设计稿'] };
  assert.deepEqual(authorizationRequirements(authorization), ['完成设计', '设计稿']);
  const audit = auditGoalCoverage(authorization, [
    { requirement: '完成设计', taskIds: ['task-pending'], evidence: '尚未验收' },
    { requirement: '设计稿', taskIds: ['task-complete'], evidence: '文件已生成' },
  ], [
    { id: 'task-pending', status: 'PENDING' },
    { id: 'task-complete', status: 'COMPLETED' },
  ]);
  assert.equal(audit.accepted, false);
  assert.match(audit.issues.join('\n'), /完成设计/);
  assert.equal(audit.coveredCount, 1);
});

test('authorization contains goals and limits but no fixed execution plan', () => {
  const authorization = coordinatorAuthorization({ goal: '做页面', steps: ['实现并验收'], deliverables: ['网页'], capabilities: ['workspace_write'] });
  assert.equal(authorization.objective, '做页面');
  assert.equal(authorization.maxTasks, 8);
  assert.equal('authorizedPlan' in authorization, false);
});

test('authorization capabilities are hard runtime boundaries', () => {
  const authorization = { capabilities: ['workspace_read'] };
  assert.equal(authorizationAllowsCapability(authorization, 'workspace_read'), true);
  assert.equal(authorizationAllowsCapability(authorization, 'workspace_write'), false);
  assert.equal(authorizationAllowsCapability(authorization, 'web_research'), false);
  assert.equal(authorizationAllowsCapability(null, 'web_research'), false);
  assert.equal(authorizationAllowsCapability({
    capabilities: ['web_research'], networkPolicy: 'forbidden',
  }, 'web_research'), false);
});

test('explicit space skill is preserved in authorization and required on first dispatch', () => {
  const selectedSkill = {
    id: 'space:review', name: '空间审查', version: 'abc123', description: '审查当前交付',
    requiredCapabilities: [], allowedTools: ['list_files', 'read_file'], artifactExtensions: [],
    instructions: '只审查当前范围。', execution: null,
  };
  const authorization = coordinatorAuthorization({
    goal: '审查方案', steps: ['完成审查'], capabilities: ['workspace_read'],
    skillSnapshot: selectedSkill, skillAgentId: 'product',
  });
  assert.equal(authorization.selectedSkill.id, selectedSkill.id);
  assert.equal(authorization.selectedSkillAgentId, 'product');
  const task = {
    agentId: 'product', mode: 'advisor', title: '审查方案', instruction: '审查当前方案。',
    acceptanceCriteria: '指出具体问题。', reason: '用户指定产品执行。', webResearchRequired: false,
  };
  assert.throws(() => normalizeCoordinatorAction({
    type: 'dispatch', tasks: [{ ...task, skillId: 'general-task' }],
  }, {
    members, remainingTasks: 8, authorization, requiredSkillId: selectedSkill.id,
    additionalSkills: [selectedSkill],
  }), /明确指定了 Skill/);
  const action = normalizeCoordinatorAction({
    type: 'dispatch', tasks: [{ ...task, skillId: selectedSkill.id }],
  }, {
    members, remainingTasks: 8, authorization, requiredSkillId: selectedSkill.id,
    additionalSkills: [selectedSkill],
  });
  assert.equal(action.tasks[0].skillId, selectedSkill.id);
});

test('dispatch approval is the safe default while auto mode remains available', () => {
  assert.equal(dispatchRequiresApproval('REVIEW_DISPATCH'), true);
  assert.equal(dispatchRequiresApproval(undefined), true);
  assert.equal(dispatchRequiresApproval('AUTO'), false);
});

test('dispatch rejection returns the coordinator to planning with user feedback', () => {
  const state = coordinatorStateAfterDispatchRejection({ iteration: 1, currentTaskIds: ['task-1'] }, {
    feedback: '这个任务应该先交给产品梳理，不要直接开发',
    task: { id: 'task-1', agentId: 'frontend', agentName: '前端', title: '直接实现页面' },
    timestamp: '2026-08-16T00:00:00.000Z',
  });
  assert.equal(state.phase, 'coordinating');
  assert.deepEqual(state.currentTaskIds, []);
  assert.equal(state.lastDispatchFeedback.agentId, 'frontend');
  assert.match(state.lastDispatchFeedback.feedback, /先交给产品/);
  assert.throws(() => coordinatorStateAfterDispatchRejection({}, { feedback: ' ', task: {} }), /说明拒绝/);
});

test('explicit dispatch feedback becomes a required next member', () => {
  assert.deepEqual(
    dispatchConstraintFromFeedback('请先交给产品明确规则，再由前端实现。', members),
    { agentId: 'product', agentName: '产品' }
  );
  assert.deepEqual(
    dispatchConstraintFromFeedback('需求已明确，不要交给产品，请直接交给前端。', members),
    { agentId: 'frontend', agentName: '前端' }
  );
  assert.equal(dispatchConstraintFromFeedback('请重新考虑成员安排。', members), null);
});

test('coordinator cannot ignore an explicitly requested next member', () => {
  assert.throws(() => normalizeCoordinatorAction({
    type: 'dispatch',
    tasks: [{
      agentId: 'frontend', title: '实现页面', instruction: '创建页面',
      acceptanceCriteria: '页面可用', reason: '前端匹配',
    }],
  }, {
    members,
    remainingTasks: 8,
    requiredAgentId: 'product',
    requiredAgentName: '产品',
  }), /先交给产品/);
});

test('explicit dispatch feedback can recover after reasoning truncation and one wrong member', async () => {
  const action = await requestCoordinatorAction(({ attempt }) => {
    if (attempt === 1) {
      return {
        coordinatorResponse: true,
        output: '',
        diagnostics: { reasoningContentChars: 6_000, finishReasons: ['length'] },
      };
    }
    const agentId = attempt === 2 ? 'frontend' : 'product';
    return {
      type: 'dispatch',
      tasks: [{
        agentId,
        mode: 'advisor',
        title: '梳理规则',
        instruction: '明确工单状态与验收规则',
        acceptanceCriteria: '输出可执行规则',
        reason: '用户明确要求产品先梳理',
      }],
    };
  }, {
    members,
    remainingTasks: 8,
    requiredAgentId: 'product',
    requiredAgentName: '产品',
  }, { maxAttempts: 3 });
  assert.equal(action.tasks[0].agentId, 'product');
  assert.equal(action.tasks[0].mode, 'advisor');
});

test('a rejected dispatch schedules a new coordinator decision instead of final acceptance', () => {
  const state = coordinatorStateAfterDispatchRejection({ iteration: 1 }, {
    feedback: '请先交给产品梳理规则',
    task: { id: 'task-1', agentId: 'frontend', agentName: '前端', title: '实现页面' },
    timestamp: '2026-08-16T10:00:00.000Z',
  });
  assert.equal(
    coordinatorDecisionTrigger('run-1', [{ id: 'task-1', status: 'CANCELLED' }], state),
    'dispatch-rejected:task-1:2026-08-16T10:00:00.000Z'
  );
  assert.equal(coordinatorDecisionTrigger('run-1', [{ status: 'PROPOSED' }], state), null);
  assert.equal(coordinatorDecisionTrigger('run-1', [], { phase: 'coordinating' }), 'run-authorized:run-1');
  assert.equal(coordinatorDecisionTrigger('run-1', [{ status: 'CANCELLED' }], { phase: 'finishing' }), null);
});
