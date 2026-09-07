import { randomUUID } from 'node:crypto';
import { describeWorkspaceArtifact, executeWorkspaceTool } from '../../lib/agent-runtime/runtime-tools.mjs';
import { runToolLoop } from '../../lib/agent-runtime/tool-loop.mjs';
import {
  applyGomokuAction,
  gomokuPreviewHtml,
  gomokuResult,
  gomokuStateText,
  validateGomokuAction,
} from '../../lib/relay/gomoku.mjs';

const RELAY_ACTION_TOOL = {
  type: 'function',
  function: {
    name: 'submit_relay_action',
    description: '提交本轮唯一动作。平台验证通过后才会应用。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['row', 'column', 'comment'],
      properties: {
        row: { type: 'integer', minimum: 1, maximum: 15 },
        column: { type: 'integer', minimum: 1, maximum: 15 },
        comment: { type: 'string', maxLength: 160 },
      },
    },
  },
};

const COLLABORATION_ACTION_TOOL = {
  type: 'function',
  function: {
    name: 'submit_relay_turn',
    description: '提交你在本轮形成的独立成果。平台会把成果交给下一位成员继续处理。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['content', 'status'],
      properties: {
        content: { type: 'string', minLength: 1, maxLength: 6000, description: '本轮可直接交给下一位成员继续处理的成果' },
        status: { type: 'string', enum: ['CONTINUE', 'COMPLETE'], description: '仍需下一位继续时为 CONTINUE；目标已经达到时为 COMPLETE' },
      },
    },
  },
};

const RELAY_REVIEW_TOOL = {
  type: 'function',
  function: {
    name: 'submit_relay_review',
    description: '提交协调者对接力成果的最终判断。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['decision', 'summary', 'instruction'],
      properties: {
        decision: { type: 'string', enum: ['COMPLETE', 'CONTINUE'] },
        summary: { type: 'string', minLength: 1, maxLength: 4000, description: '向用户公开说明验收结论和依据' },
        instruction: { type: 'string', maxLength: 1000, description: '继续接力时交给下一位成员的具体补充要求；完成时留空' },
      },
    },
  },
};

function parseJson(value, fallback) {
  if (!value) return fallback;
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return fallback; }
}

export function createRelayRuntime({
  db,
  projectRoot,
  completeMessage,
  loadRunContext,
  now = () => new Date().toISOString(),
  runLoop = runToolLoop,
  executeWorkspace = executeWorkspaceTool,
  describeArtifact = describeWorkspaceArtifact,
}) {
  const workspaceOptions = (relay) => ({
    projectRoot,
    userId: relay.userId,
    spaceId: relay.spaceId,
    isCancelled: () => isCancelRequested(relay.id),
  });

  function relayStatus(relayId) {
    return db.prepare('SELECT "status" FROM "SpaceRelay" WHERE "id" = ?').get(relayId)?.status || null;
  }

  function isCancelRequested(relayId) {
    return ['CANCEL_REQUESTED', 'CANCELLED'].includes(relayStatus(relayId));
  }

  function cancelRelay(relayId) {
    const timestamp = now();
    db.prepare(
      `UPDATE "SpaceRelay" SET "status" = 'CANCELLED', "pendingAction" = NULL,
       "completedAt" = ?, "updatedAt" = ? WHERE "id" = ?`
    ).run(timestamp, timestamp, relayId);
  }

  async function registerFile(relay, logicalPath) {
    const artifact = await describeArtifact(workspaceOptions(relay), logicalPath);
    const timestamp = now();
    const existing = db.prepare(
      `SELECT "id" FROM "SpaceFile" WHERE "spaceId" = ? AND "relativePath" = ? ORDER BY "createdAt" DESC LIMIT 1`
    ).get(relay.spaceId, artifact.relativePath);
    if (existing) {
      db.prepare(
        `UPDATE "SpaceFile" SET "fileName" = ?, "mimeType" = ?, "size" = ?,
         "status" = 'READY', "updatedAt" = ? WHERE "id" = ?`
      ).run(artifact.fileName, artifact.mimeType, artifact.size, timestamp, existing.id);
    } else {
      db.prepare(
        `INSERT INTO "SpaceFile" ("id", "spaceId", "fileName", "mimeType", "size", "relativePath",
         "status", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, 'READY', ?, ?)`
      ).run(artifact.id, relay.spaceId, artifact.fileName, artifact.mimeType, artifact.size, artifact.relativePath, timestamp, timestamp);
    }
  }

  async function writeStateFiles(relay, state, includePreview = false) {
    const base = `relays/${relay.id}`;
    if (includePreview) {
      await executeWorkspace(workspaceOptions(relay), 'write_file', {
        path: `${base}/index.html`,
        content: gomokuPreviewHtml(),
      });
      await registerFile(relay, `${base}/index.html`);
    }
    await executeWorkspace(workspaceOptions(relay), 'write_file', {
      path: `${base}/state.json`,
      content: `${JSON.stringify(state, null, 2)}\n`,
    });
    await registerFile(relay, `${base}/state.json`);
  }

  function completeRelay(relay, state, transcript, result, incrementTurn = true) {
    const timestamp = now();
    db.transaction(() => {
      const changed = db.prepare(
        `UPDATE "SpaceRelay" SET "status" = 'COMPLETED', "state" = ?, "transcript" = ?,
         "pendingAction" = NULL, "turnCount" = "turnCount" + ?,
         "result" = ?, "completedAt" = ?, "updatedAt" = ?
         WHERE "id" = ? AND "status" = 'RUNNING'`
      ).run(JSON.stringify(state), JSON.stringify(transcript), incrementTurn ? 1 : 0, result, timestamp, timestamp, relay.id);
      if (changed.changes !== 1) return;
      db.prepare(
        `INSERT INTO "SpaceMessage" ("id", "spaceId", "role", "speakerAgentId", "content", "attachments", "createdAt")
         VALUES (?, ?, 'assistant', 'space-coordinator', ?, ?, ?)`
      ).run(randomUUID(), relay.spaceId, result, JSON.stringify([{ type: 'relay_summary', relayId: relay.id }]), timestamp);
      db.prepare('UPDATE "Space" SET "updatedAt" = ? WHERE "id" = ?').run(timestamp, relay.spaceId);
    })();
  }

  async function completeCollaboration(relay, state, transcript, context, reason) {
    const participantNames = parseJson(relay.participantIds, [])
      .map((id) => context.agents.find((agent) => agent.id === id)?.name)
      .filter(Boolean)
      .join('、');
    const latestTurns = transcript.slice(-8)
      .map((entry) => `[${entry.agentName}] ${entry.action.content}`)
      .join('\n\n');
    const controller = new AbortController();
    const cancellationTimer = setInterval(() => {
      if (isCancelRequested(relay.id)) controller.abort();
    }, 500);
    let review = null;
    try {
      await runLoop({
        messages: [
          {
            role: 'system',
            content: [
              '你是空间协调者，负责对本次接力协作做最终验收。',
              '只根据目标、完成条件和成员实际提交的成果判断，不补写成员没有完成的工作。',
              relay.turnCount >= relay.maxTurns
                ? '已经达到轮次上限，必须选择 COMPLETE，并在总结中如实说明未完成部分。'
                : '成果未达到条件时选择 CONTINUE，并给下一位成员一条具体补充要求；否则选择 COMPLETE。',
              '必须调用 submit_relay_review，不要只输出普通文本。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `协作目标：${relay.goal}`,
              `参与成员：${participantNames}`,
              `完成条件：${parseJson(state.completionCriteria, []).join('；') || '达到用户给出的协作目标'}`,
              `进入验收的原因：${reason}`,
              `成员成果：\n${latestTurns}`,
            ].join('\n\n'),
          },
        ],
        tools: [RELAY_REVIEW_TOOL],
        requiredFinalTool: 'submit_relay_review',
        maxIterations: 2,
        maxToolCalls: 2,
        requestCompletion: (messages, tools, request) => completeMessage(
          context.model,
          messages,
          tools,
          { signal: controller.signal, agentId: 'space-coordinator', iteration: request.iteration }
        ),
        executeTool: async (name, args) => {
          if (name !== 'submit_relay_review') throw new Error('协调者验收只能提交接力判断');
          const requestedDecision = args.decision === 'CONTINUE' ? 'CONTINUE' : 'COMPLETE';
          review = {
            decision: relay.turnCount >= relay.maxTurns ? 'COMPLETE' : requestedDecision,
            summary: typeof args.summary === 'string' ? args.summary.trim().slice(0, 4000) : '',
            instruction: typeof args.instruction === 'string' ? args.instruction.trim().slice(0, 1000) : '',
          };
          if (!review.summary) throw new Error('协调者验收总结不能为空');
          if (review.decision === 'CONTINUE' && !review.instruction) throw new Error('继续接力必须给出补充要求');
          return { ok: true, stop: true, content: review.summary };
        },
        isCancelled: () => controller.signal.aborted,
      });
    } finally {
      clearInterval(cancellationTimer);
    }
    if (controller.signal.aborted || isCancelRequested(relay.id)) {
      cancelRelay(relay.id);
      return;
    }
    if (!review) throw new Error('协调者没有提交接力验收结果');
    if (review.decision === 'CONTINUE') {
      const timestamp = now();
      const participants = parseJson(relay.participantIds, []);
      db.transaction(() => {
        const changed = db.prepare(
          `UPDATE "SpaceRelay" SET "status" = ?, "state" = ?, "pendingAction" = ?,
           "currentIndex" = ?, "error" = NULL, "updatedAt" = ?
           WHERE "id" = ? AND "status" = 'RUNNING'`
        ).run(
          relay.approvalMode === 'EACH_TURN' ? 'WAITING_APPROVAL' : 'QUEUED',
          JSON.stringify(relay.approvalMode === 'EACH_TURN' ? state : {
            ...state,
            phase: 'turns',
            completionReason: null,
            summaryAttempts: 0,
            coordinatorInstruction: review.instruction,
          }),
          relay.approvalMode === 'EACH_TURN' ? JSON.stringify({
            type: 'coordinator_continue',
            summary: review.summary,
            instruction: review.instruction,
            approved: false,
          }) : null,
          relay.approvalMode === 'EACH_TURN'
            ? relay.currentIndex
            : (relay.currentIndex + 1) % participants.length,
          timestamp,
          relay.id
        );
        if (changed.changes !== 1) return;
        db.prepare(
          `INSERT INTO "SpaceMessage" ("id", "spaceId", "role", "speakerAgentId", "content", "attachments", "createdAt")
           VALUES (?, ?, 'assistant', 'space-coordinator', ?, ?, ?)`
        ).run(
          randomUUID(), relay.spaceId, review.summary,
          JSON.stringify([{ type: 'relay_review', relayId: relay.id, decision: 'CONTINUE' }]), timestamp
        );
      })();
      return;
    }
    completeRelay(relay, state, transcript, review.summary, false);
  }

  function resolveCoordinatorContinuation(relay, state, transcript, pending) {
    if (pending.decision === 'stop') {
      completeRelay(
        relay,
        { ...state, phase: 'completed', completionReason: '用户选择结束接力' },
        transcript,
        `用户选择结束接力。${pending.summary || ''}`.trim(),
        false
      );
      return;
    }
    const participants = parseJson(relay.participantIds, []);
    const timestamp = now();
    db.prepare(
      `UPDATE "SpaceRelay" SET "status" = 'QUEUED', "state" = ?, "pendingAction" = NULL,
       "currentIndex" = ("currentIndex" + 1) % ?, "error" = NULL, "updatedAt" = ?
       WHERE "id" = ? AND "status" = 'RUNNING'`
    ).run(JSON.stringify({
      ...state,
      phase: 'turns',
      completionReason: null,
      summaryAttempts: 0,
      coordinatorInstruction: pending.instruction || '',
    }), participants.length, timestamp, relay.id);
  }

  async function applyAction(relay, context, actionRecord) {
    const state = parseJson(relay.state, null);
    if (!state || Number(actionRecord.expectedVersion) !== Number(state.version)) {
      throw new Error('接力状态已变化，请重新生成本轮动作');
    }
    const participants = parseJson(relay.participantIds, []);
    const agentById = new Map(context.agents.map((agent) => [agent.id, agent]));
    const agentId = participants[relay.currentIndex];
    const agent = agentById.get(agentId);
    if (!agent || actionRecord.agentId !== agentId) throw new Error('接力成员或轮次已经变化');
    const nextState = relay.kind === 'gomoku'
      ? applyGomokuAction(state, actionRecord.action, relay.currentIndex, agent.id, agent.name)
      : {
          ...state,
          version: Number(state.version || 0) + 1,
          lastAgentId: agent.id,
          lastContent: actionRecord.action.content,
          coordinatorInstruction: null,
        };
    if (relay.kind === 'gomoku') await writeStateFiles(relay, nextState, relay.turnCount === 0);
    const transcript = [
      ...parseJson(relay.transcript, []),
      {
        turn: relay.turnCount + 1,
        agentId: agent.id,
        agentName: agent.name,
        action: actionRecord.action,
        createdAt: now(),
      },
    ];
    if (relay.kind === 'collaboration') {
      const terminal = actionRecord.action.status === 'COMPLETE' || relay.turnCount + 1 >= relay.maxTurns;
      const reason = actionRecord.action.status === 'COMPLETE'
        ? `${agent.name} 判断协作目标已经达到`
        : `达到 ${relay.maxTurns} 轮上限`;
      const persistedState = terminal
        ? { ...nextState, phase: 'summarizing', completionReason: reason, summaryAttempts: 0 }
        : nextState;
      const timestamp = now();
      db.transaction(() => {
        const changed = db.prepare(
          `UPDATE "SpaceRelay" SET "status" = 'QUEUED', "state" = ?, "transcript" = ?,
           "pendingAction" = NULL, "turnCount" = "turnCount" + 1,
           "currentIndex" = ?, "error" = NULL, "updatedAt" = ?
           WHERE "id" = ? AND "status" = 'RUNNING'`
        ).run(
          JSON.stringify(persistedState), JSON.stringify(transcript),
          terminal ? relay.currentIndex : (relay.currentIndex + 1) % participants.length,
          timestamp, relay.id
        );
        if (changed.changes !== 1) return;
        db.prepare(
          `INSERT INTO "SpaceMessage" ("id", "spaceId", "role", "speakerAgentId", "content", "attachments", "createdAt")
           VALUES (?, ?, 'assistant', ?, ?, ?, ?)`
        ).run(
          randomUUID(), relay.spaceId, agent.id, actionRecord.action.content,
          JSON.stringify([{ type: 'relay_turn', relayId: relay.id, turn: relay.turnCount + 1 }]), timestamp
        );
        db.prepare('UPDATE "Space" SET "updatedAt" = ? WHERE "id" = ?').run(timestamp, relay.spaceId);
      })();
      return;
    }
    const terminalResult = relay.kind === 'gomoku'
      ? gomokuResult(nextState) || (relay.turnCount + 1 >= relay.maxTurns ? `已达到 ${relay.maxTurns} 轮上限，接力自动停止。` : '')
      : '';
    if (terminalResult) {
      completeRelay(relay, nextState, transcript, terminalResult);
      return;
    }
    const timestamp = now();
    db.prepare(
      `UPDATE "SpaceRelay" SET "status" = 'QUEUED', "state" = ?, "transcript" = ?,
       "pendingAction" = NULL, "turnCount" = "turnCount" + 1,
       "currentIndex" = ("currentIndex" + 1) % ?, "error" = NULL, "updatedAt" = ?
       WHERE "id" = ? AND "status" = 'RUNNING'`
    ).run(JSON.stringify(nextState), JSON.stringify(transcript), participants.length, timestamp, relay.id);
  }

  async function processRelay(initialRelay) {
    let relay = initialRelay;
    let currentAgent = null;
    try {
      if (!['collaboration', 'gomoku'].includes(relay.kind)) throw new Error(`不支持的接力适配器：${relay.kind}`);
      const context = loadRunContext(relay);
      const participants = parseJson(relay.participantIds, []);
      const agentById = new Map(context.agents.map((agent) => [agent.id, agent]));
      currentAgent = agentById.get(participants[relay.currentIndex]);
      if (participants.length < 2 || !currentAgent) throw new Error('接力成员不足或成员已被移除');
      const state = parseJson(relay.state, null);
      if (!state) throw new Error('接力状态损坏');

      const pending = parseJson(relay.pendingAction, null);
      if (pending?.type === 'coordinator_continue' && pending.approved) {
        resolveCoordinatorContinuation(relay, state, parseJson(relay.transcript, []), pending);
        return;
      }

      if (relay.kind === 'collaboration' && state.phase === 'summarizing') {
        await completeCollaboration(
          relay,
          state,
          parseJson(relay.transcript, []),
          context,
          state.completionReason || '成员已完成接力'
        );
        return;
      }

      if (pending?.approved) {
        await applyAction(relay, context, pending);
        return;
      }

      const controller = new AbortController();
      const cancellationTimer = setInterval(() => {
        if (isCancelRequested(relay.id)) controller.abort();
      }, 500);
      let submittedAction = null;
      try {
        const recentMoves = relay.kind === 'gomoku' ? state.moves.slice(-8).map((move) => (
          `第 ${move.number} 手：${move.agentName} 落在 ${move.row},${move.column}${move.comment ? `（${move.comment}）` : ''}`
        )).join('\n') : '';
        const rejectedAction = pending?.rejected
          ? relay.kind === 'gomoku'
            ? `用户拒绝了上一提议：${pending.action?.row},${pending.action?.column}。请重新判断并选择不同的合法位置。`
            : `用户拒绝了上一轮成果：${String(pending.action?.content || '').slice(0, 500)}。请根据目标重新形成有实质变化的成果。`
          : '';
        const collaborationTranscript = relay.kind === 'collaboration'
          ? parseJson(relay.transcript, []).slice(-8).map((entry) => `[${entry.agentName}] ${entry.action.content}`).join('\n\n')
          : '';
        await runLoop({
          messages: relay.kind === 'gomoku' ? [
            {
              role: 'system',
              content: [
                currentAgent.systemPrompt || currentAgent.description || `你是 ${currentAgent.name}。`,
                currentAgent.memoryContext || '',
                `你正在参加一个持久化接力协作，当前只以“${currentAgent.name}”身份完成自己这一轮。`,
                '当前适配器是 15×15 五子棋。你执子的目标是形成横、竖或斜向连续五子，同时阻止对手。',
                `你是${relay.currentIndex === 0 ? '黑方（●）' : '白方（○）'}。行列均从 1 开始。`,
                '分析当前棋盘后必须调用 submit_relay_action 提交唯一落子。不得代替对方落子，不得输出或修改文件。',
              ].join('\n\n'),
            },
            {
              role: 'user',
              content: [
                `接力目标：${relay.goal}`,
                `当前第 ${relay.turnCount + 1}/${relay.maxTurns} 手。`,
                `棋盘：\n${gomokuStateText(state)}`,
                recentMoves ? `最近动作：\n${recentMoves}` : '当前还没有落子。',
                rejectedAction,
              ].join('\n\n'),
            },
          ] : [
            {
              role: 'system',
              content: [
                currentAgent.systemPrompt || currentAgent.description || `你是 ${currentAgent.name}。`,
                currentAgent.memoryContext || '',
                `你正在参加由空间协调者组织的接力协作。当前只以“${currentAgent.name}”身份完成自己这一轮。`,
                '必须承接已有成果，增加新的判断、改进或收敛，不要从头重复问题。',
                '完成后必须调用 submit_relay_turn。不得代替其他成员发言，不得读写文件、联网、运行命令或调用 Skill。',
              ].join('\n\n'),
            },
            {
              role: 'user',
              content: [
                `协作目标：${relay.goal}`,
                `完成条件：${parseJson(state.completionCriteria, []).join('；') || '达到用户给出的协作目标'}`,
                `当前第 ${relay.turnCount + 1}/${relay.maxTurns} 轮。`,
                state.coordinatorInstruction ? `协调者补充要求：${state.coordinatorInstruction}` : '',
                collaborationTranscript ? `已有成果：\n${collaborationTranscript}` : '你是第一位成员，请形成可供下一位继续的初始成果。',
                rejectedAction,
              ].filter(Boolean).join('\n\n'),
            },
          ],
          tools: [relay.kind === 'gomoku' ? RELAY_ACTION_TOOL : COLLABORATION_ACTION_TOOL],
          requiredFinalTool: relay.kind === 'gomoku' ? 'submit_relay_action' : 'submit_relay_turn',
          maxIterations: 3,
          maxToolCalls: 3,
          requestCompletion: (messages, tools, request) => completeMessage(
            context.model,
            messages,
            tools,
            { signal: controller.signal, agentId: currentAgent.id, iteration: request.iteration }
          ),
          executeTool: async (name, args) => {
            const expectedTool = relay.kind === 'gomoku' ? 'submit_relay_action' : 'submit_relay_turn';
            if (name !== expectedTool) throw new Error('接力轮次只允许提交本轮成果');
            const action = relay.kind === 'gomoku'
              ? validateGomokuAction(state, args)
              : {
                  content: typeof args.content === 'string' ? args.content.trim().slice(0, 6000) : '',
                  status: args.status === 'COMPLETE' ? 'COMPLETE' : 'CONTINUE',
                };
            if (relay.kind === 'collaboration' && !action.content) throw new Error('本轮成果不能为空');
            submittedAction = {
              agentId: currentAgent.id,
              agentName: currentAgent.name,
              expectedVersion: state.version,
              action,
              approved: relay.approvalMode === 'AUTO',
            };
            return { ok: true, stop: true, content: action.comment || '本轮动作已提交' };
          },
          isCancelled: () => controller.signal.aborted,
        });
      } finally {
        clearInterval(cancellationTimer);
      }
      if (controller.signal.aborted || isCancelRequested(relay.id)) {
        cancelRelay(relay.id);
        return;
      }
      if (!submittedAction) throw new Error('成员没有提交有效接力动作');
      if (relay.approvalMode === 'EACH_TURN') {
        db.prepare(
          `UPDATE "SpaceRelay" SET "status" = 'WAITING_APPROVAL', "pendingAction" = ?,
           "error" = NULL, "updatedAt" = ? WHERE "id" = ? AND "status" = 'RUNNING'`
        ).run(JSON.stringify(submittedAction), now(), relay.id);
        return;
      }
      await applyAction(relay, context, submittedAction);
    } catch (error) {
      if (isCancelRequested(relay.id) || error?.name === 'AbortError') {
        cancelRelay(relay.id);
        return;
      }
      const timestamp = now();
      const state = parseJson(relay.state, null);
      if (relay.kind === 'collaboration' && state?.phase === 'summarizing' && Number(state.summaryAttempts || 0) < 2) {
        db.prepare(
          `UPDATE "SpaceRelay" SET "status" = 'QUEUED', "state" = ?, "error" = ?, "updatedAt" = ? WHERE "id" = ?`
        ).run(
          JSON.stringify({ ...state, summaryAttempts: Number(state.summaryAttempts || 0) + 1 }),
          '协调者总结暂时失败，正在重试', timestamp, relay.id
        );
        return;
      }
      db.prepare(
        `UPDATE "SpaceRelay" SET "status" = 'FAILED', "error" = ?, "completedAt" = ?, "updatedAt" = ? WHERE "id" = ?`
      ).run((error instanceof Error ? error.message : String(error)).slice(0, 2000), timestamp, timestamp, relay.id);
    }
  }

  return { processRelay };
}
