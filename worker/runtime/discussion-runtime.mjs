import { randomUUID } from 'node:crypto';
import {
  executeWorkspaceTool,
  researchRequirements,
  searchWeb,
  workspaceToolSchemas,
} from '../../lib/agent-runtime/runtime-tools.mjs';
import { runToolLoop } from '../../lib/agent-runtime/tool-loop.mjs';
import { discussionSequence, nextDiscussionPosition } from '../policies/discussion-policy.mjs';

const DISCUSSION_READ_TOOLS = new Set(['list_files', 'read_file', 'check_files']);
const DISCUSSION_RESEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'request_web_research',
    description: '仅当讨论中的关键事实需要外部最新资料验证时，申请一次受控联网搜索。不要用它创建任务或执行工作。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query', 'reason'],
      properties: {
        query: { type: 'string', description: '简洁、具体的搜索关键词' },
        reason: { type: 'string', description: '为什么当前讨论需要这项外部资料' },
      },
    },
  },
};

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

export function createDiscussionRuntime({
  db,
  projectRoot,
  completeMessage,
  loadRunContext,
  persistSpaceMemory,
  now = () => new Date().toISOString(),
  search = searchWeb,
  runLoop = runToolLoop,
  executeWorkspace = executeWorkspaceTool,
}) {
  function isDiscussionCancelRequested(discussionId) {
    const row = db.prepare('SELECT "status" FROM "SpaceDiscussion" WHERE "id" = ?').get(discussionId);
    return !row || row.status === 'CANCEL_REQUESTED' || row.status === 'CANCELLED';
  }

  function isDiscussionWaitingForResearch(discussionId) {
    return db.prepare('SELECT "status" FROM "SpaceDiscussion" WHERE "id" = ?').get(discussionId)?.status === 'WAITING_RESEARCH';
  }

  function cancelDiscussion(discussionId) {
    const timestamp = now();
    db.prepare(
      `UPDATE "SpaceDiscussion" SET "status" = 'CANCELLED', "pendingResearch" = NULL, "completedAt" = ?, "updatedAt" = ? WHERE "id" = ?`
    ).run(timestamp, timestamp, discussionId);
  }

  function persistAndQueueDiscussionTurn(discussion, agentId, content, attachment, transcript, participantCount) {
    const next = nextDiscussionPosition(discussion.currentRound, discussion.currentIndex, participantCount);
    const saved = db.transaction(() => {
      const status = db.prepare('SELECT "status" FROM "SpaceDiscussion" WHERE "id" = ?').get(discussion.id)?.status;
      if (status !== 'RUNNING') return false;
      const timestamp = now();
      db.prepare(
        `INSERT INTO "SpaceMessage" ("id", "spaceId", "role", "speakerAgentId", "content", "attachments", "createdAt") VALUES (?, ?, 'assistant', ?, ?, ?, ?)`
      ).run(randomUUID(), discussion.spaceId, agentId, content, JSON.stringify([attachment]), timestamp);
      db.prepare(`UPDATE "Space" SET "updatedAt" = ? WHERE "id" = ?`).run(timestamp, discussion.spaceId);
      db.prepare(
        `UPDATE "SpaceDiscussion" SET "status" = 'QUEUED', "transcript" = ?, "currentRound" = ?, "currentIndex" = ?, "error" = NULL, "updatedAt" = ? WHERE "id" = ?`
      ).run(JSON.stringify(transcript), next.round, next.index, timestamp, discussion.id);
      return true;
    })();
    if (!saved && isDiscussionCancelRequested(discussion.id)) cancelDiscussion(discussion.id);
  }

  async function completeApprovedDiscussionResearch(discussion, context) {
    const pending = parseJson(discussion.pendingResearch, null);
    if (!pending?.approved || !pending.query) return discussion;

    let researchText;
    try {
      const result = await search([String(pending.query)], context.tavilyApiKey, {
        requirements: researchRequirements(String(pending.query)),
      });
      researchText = result.context || '本次联网搜索没有返回可用来源。';
    } catch (error) {
      researchText = `联网搜索失败：${error instanceof Error ? error.message : String(error)}。请使用现有资料继续并说明限制。`;
    }
    const researchContext = [discussion.researchContext, researchText].filter(Boolean).join('\n\n').slice(-20_000);
    db.prepare(
      `UPDATE "SpaceDiscussion" SET "pendingResearch" = NULL, "researchContext" = ?, "webSearchCount" = "webSearchCount" + 1, "updatedAt" = ? WHERE "id" = ?`
    ).run(researchContext, now(), discussion.id);
    return { ...discussion, pendingResearch: null, researchContext, webSearchCount: discussion.webSearchCount + 1 };
  }

  async function summarizeDiscussion(discussion, context, transcript, signal) {
    const transcriptText = transcript
      .map((entry) => `[第 ${entry.round} 轮 · ${entry.agentName}]\n${entry.content}`)
      .join('\n\n');
    const response = await completeMessage(context.model, [
      {
        role: 'system',
        content: [
          '你是空间协调者。请根据成员的真实讨论生成简洁、客观的最终总结。',
          '必须分别列出：形成的共识、仍存在的分歧、推荐方案、需要用户决定的问题。',
          '只总结讨论，不创建任务方案，不声称已经执行、写入文件或完成联网之外的操作。',
          context.space.instructions ? `当前空间规则：\n${context.space.instructions}` : '',
        ].filter(Boolean).join('\n\n'),
      },
      { role: 'user', content: `讨论主题：${discussion.topic}\n\n成员讨论：\n${transcriptText}` },
    ], [], { signal });
    const content = response.content?.trim() || '讨论已经结束，但协调者没有生成有效总结。';
    if (signal.aborted || isDiscussionCancelRequested(discussion.id)) {
      cancelDiscussion(discussion.id);
      return;
    }
    const saved = db.transaction(() => {
      const status = db.prepare('SELECT "status" FROM "SpaceDiscussion" WHERE "id" = ?').get(discussion.id)?.status;
      if (status !== 'RUNNING') return false;
      const timestamp = now();
      db.prepare(
        `INSERT INTO "SpaceMessage" ("id", "spaceId", "role", "speakerAgentId", "content", "attachments", "createdAt") VALUES (?, ?, 'assistant', 'space-coordinator', ?, ?, ?)`
      ).run(randomUUID(), discussion.spaceId, content, JSON.stringify([{ type: 'discussion_summary', discussionId: discussion.id }]), timestamp);
      db.prepare(`UPDATE "Space" SET "updatedAt" = ? WHERE "id" = ?`).run(timestamp, discussion.spaceId);
      db.prepare(
        `UPDATE "SpaceDiscussion" SET "status" = 'COMPLETED', "result" = ?, "completedAt" = ?, "updatedAt" = ? WHERE "id" = ?`
      ).run(content, timestamp, timestamp, discussion.id);
      persistSpaceMemory(discussion.spaceId, [{
        type: 'discussion',
        actor: '空间协调者',
        summary: `${discussion.topic}：${content}`,
        at: timestamp,
        refId: discussion.id,
      }], timestamp);
      return true;
    })();
    if (!saved && isDiscussionCancelRequested(discussion.id)) cancelDiscussion(discussion.id);
  }

  async function processDiscussion(initialDiscussion) {
    let discussion = initialDiscussion;
    let currentAgent = null;
    try {
      const context = loadRunContext(discussion);
      const participantIds = parseJson(discussion.participantIds, []);
      const agentById = new Map(context.agents.map((agent) => [agent.id, agent]));
      const participants = participantIds.map((id) => agentById.get(id)).filter(Boolean);
      if (participants.length < 2) throw new Error('讨论成员不足两位或成员已被移除');

      discussion = await completeApprovedDiscussionResearch(discussion, context);
      const transcript = parseJson(discussion.transcript, []);
      const controller = new AbortController();
      const cancellationTimer = setInterval(() => {
        if (isDiscussionCancelRequested(discussion.id)) controller.abort();
      }, 500);

      try {
        if (discussion.currentRound > discussion.maxRounds) {
          await summarizeDiscussion(discussion, context, transcript, controller.signal);
          return;
        }

        const sequence = discussionSequence(participants, discussion.currentRound);
        currentAgent = sequence[discussion.currentIndex];
        if (!currentAgent) throw new Error('无法确定当前讨论成员');
        let researchContext = discussion.researchContext || '';
        let turnSearchCount = 0;
        let researchPending = false;
        const transcriptText = transcript
          .map((entry) => `[第 ${entry.round} 轮 · ${entry.agentName}]\n${entry.content}`)
          .join('\n\n');
        const roundInstruction = discussion.currentRound === 1
          ? '这是第一轮。请从你的专业角度提出独立判断、关键依据、风险和建议。'
          : '这是第二轮交叉回应。请回应前面成员的关键观点，指出同意、分歧和需要修正之处，不要重复第一轮内容。';
        const tools = [
          ...workspaceToolSchemas.filter((tool) => DISCUSSION_READ_TOOLS.has(tool.function.name)),
          DISCUSSION_RESEARCH_TOOL,
        ];
        const result = await runLoop({
          messages: [
            {
              role: 'system',
              content: [
                currentAgent.systemPrompt || currentAgent.description || `你是 ${currentAgent.name}。`,
                `你正在以“${currentAgent.name}”的身份参加空间多人讨论。${roundInstruction}`,
                '当前只允许讨论、分析、读取必要的空间资料和申请受控联网搜索。',
                '不得创建任务方案，不得调用或描述 propose_task，不得写文件、运行命令、操作浏览器或声称已经执行工作。',
                '需要联网且尚未获得授权时，调用 request_web_research；一次只申请一个具体查询。',
                '如果用户已经拒绝某项联网查询，不要重复申请同一查询；使用现有资料继续并说明限制。',
                context.space.description ? `当前空间说明：${context.space.description}` : '',
                context.space.instructions ? `当前空间规则：\n${context.space.instructions}` : '',
              ].filter(Boolean).join('\n\n'),
            },
            {
              role: 'user',
              content: [
                `讨论主题：${discussion.topic}`,
                transcriptText ? `此前发言：\n${transcriptText}` : '',
                researchContext ? `已获得的受控联网资料：\n${researchContext}` : '',
                `现在轮到 ${currentAgent.name} 发言。`,
              ].filter(Boolean).join('\n\n'),
            },
          ],
          tools,
          requestCompletion: (messages, availableTools) => completeMessage(
            context.model,
            messages,
            availableTools,
            { signal: controller.signal }
          ),
          executeTool: async (name, args) => {
            if (name === 'request_web_research') {
              const query = String(args.query || '').trim().slice(0, 300);
              const reason = String(args.reason || '').trim().slice(0, 500);
              if (!query) return { ok: false, error: '搜索关键词不能为空' };
              if (discussion.webSearchCount + turnSearchCount >= 6) {
                return { ok: false, error: '本次讨论已达到 6 次联网搜索上限，请使用现有资料继续' };
              }
              if (!discussion.allowWeb) {
                db.prepare(
                  `UPDATE "SpaceDiscussion" SET "status" = 'WAITING_RESEARCH', "pendingResearch" = ?, "updatedAt" = ? WHERE "id" = ?`
                ).run(JSON.stringify({ query, reason, agentId: currentAgent.id, agentName: currentAgent.name }), now(), discussion.id);
                researchPending = true;
                return { ok: false, error: '等待用户决定是否允许本次联网查询' };
              }
              const searchResult = await search([query], context.tavilyApiKey, {
                requirements: researchRequirements(query),
              });
              turnSearchCount += 1;
              researchContext = [researchContext, searchResult.context].filter(Boolean).join('\n\n').slice(-20_000);
              db.prepare(
                `UPDATE "SpaceDiscussion" SET "researchContext" = ?, "webSearchCount" = "webSearchCount" + 1, "updatedAt" = ? WHERE "id" = ?`
              ).run(researchContext, now(), discussion.id);
              return { ok: true, context: searchResult.context };
            }
            if (!DISCUSSION_READ_TOOLS.has(name)) throw new Error('讨论模式只允许读取和检查空间资料');
            return executeWorkspace(
              { projectRoot, userId: discussion.userId, spaceId: discussion.spaceId, isCancelled: () => controller.signal.aborted },
              name,
              args
            );
          },
          isCancelled: () => controller.signal.aborted || researchPending,
        });

        if (controller.signal.aborted || isDiscussionCancelRequested(discussion.id)) {
          cancelDiscussion(discussion.id);
          return;
        }
        const content = result.content?.trim() || `${currentAgent.name}本轮没有补充新的观点。`;
        const entry = { agentId: currentAgent.id, agentName: currentAgent.name, round: discussion.currentRound, content };
        persistAndQueueDiscussionTurn(discussion, currentAgent.id, content, {
          type: 'discussion_turn',
          discussionId: discussion.id,
          round: discussion.currentRound,
        }, [...transcript, entry], sequence.length);
      } finally {
        clearInterval(cancellationTimer);
      }
    } catch (error) {
      if (isDiscussionWaitingForResearch(discussion.id)) return;
      if (isDiscussionCancelRequested(discussion.id) || error?.name === 'AbortError') {
        cancelDiscussion(discussion.id);
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      if (currentAgent && discussion.currentRound <= discussion.maxRounds) {
        const transcript = parseJson(discussion.transcript, []);
        const failure = `${currentAgent.name}本轮响应失败，已跳过：${message.slice(0, 300)}`;
        persistAndQueueDiscussionTurn(discussion, currentAgent.id, failure, {
          type: 'discussion_turn',
          discussionId: discussion.id,
          round: discussion.currentRound,
          failed: true,
        }, [
          ...transcript,
          { agentId: currentAgent.id, agentName: currentAgent.name, round: discussion.currentRound, content: failure },
        ], parseJson(discussion.participantIds, []).length);
        return;
      }

      const timestamp = now();
      db.prepare(
        `UPDATE "SpaceDiscussion" SET "status" = 'FAILED', "error" = ?, "completedAt" = ?, "updatedAt" = ? WHERE "id" = ?`
      ).run(message.slice(0, 2000), timestamp, timestamp, discussion.id);
    }
  }

  return { processDiscussion };
}
