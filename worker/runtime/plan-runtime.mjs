import { randomUUID } from 'node:crypto';
import { readyAuthorizedPlanIndexes } from '../../lib/agent-runtime-v2-policy.mjs';
import { taskModelRequestLimit } from '../../lib/task-execution-plan.mjs';
import { mergeOverlappingPlanTasks } from '../policies/plan-policy.mjs';

function parsePlan(content, agents, goal) {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('协调者没有返回有效 JSON 计划');
  const parsed = JSON.parse(content.slice(start, end + 1));
  if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) throw new Error('协调者返回了空任务计划');
  const validIds = new Set(agents.map((agent) => agent.id));
  const tasks = parsed.tasks.slice(0, 8).map((task, index) => {
    const agentId = validIds.has(String(task.agentId)) ? String(task.agentId) : agents[index % agents.length].id;
    return {
      agentId,
      title: String(task.title || `步骤 ${index + 1}`).trim().slice(0, 120),
      instruction: String(task.instruction || goal).trim().slice(0, 8000),
      deliverables: Array.isArray(task.deliverables)
        ? task.deliverables.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
        : [],
    };
  });
  return mergeOverlappingPlanTasks(tasks).map((task) => ({
    ...task,
    instruction: task.deliverables.length > 0
      ? `${task.instruction}\n\n独立验收产物：${task.deliverables.join('、')}`
      : task.instruction,
  }));
}

export function createPlanRuntime({
  db,
  complete,
  addEvent,
  fakeMode = false,
  now = () => new Date().toISOString(),
}) {
  async function createPlan(run, context) {
    if (fakeMode) {
      return context.agents.slice(0, Math.min(3, context.agents.length)).map((agent, index) => ({
        agentId: agent.id,
        title: `${agent.name}处理步骤 ${index + 1}`,
        instruction: `围绕目标“${run.input}”，从${agent.name}专业角度给出可验证的结果。`,
      }));
    }

    const catalog = context.agents
      .map((agent) => `- ${agent.id} | ${agent.name} | ${agent.description || agent.category || '暂无描述'}`)
      .join('\n');
    const content = await complete(context.model, [
      {
        role: 'system',
        content:
          '你是任务协调者。把用户目标拆成 1 到 8 个可顺序执行、可验证的步骤，并只分配给给定成员。' +
          '只输出 JSON：{"tasks":[{"agentId":"成员ID","title":"步骤标题","instruction":"完整执行说明","deliverables":["该步骤独立验收的文件路径或结果名称"]}]}。' +
          '必须按独立验收产物拆分，不得按功能点、实现阶段或检查阶段拆分。由同一成员创建、修改和检查同一产物的工作必须合并为一个步骤；实现、检查和交付属于同一步。' +
          '单个网页、单个文档、单个脚本或其他单一产物默认只安排一个端到端步骤。只有产物可以独立验收、需要不同成员专业能力或存在明确前后依赖时才拆成多步。' +
          'deliverables 必须使用稳定、具体的标识；已知文件路径时填写工作区相对路径。多个步骤不得为同一成员重复填写相同产物。' +
          '不要输出 Markdown，不要虚构成员。需要交付网页、代码或文档时，应明确要求成员在空间工作区创建文件并执行文件检查；' +
          '不得把询问用户、等待用户补充或确认关键输入安排为后台步骤；任务开始前仍缺少必要输入时，不要编造默认值。' +
          '如果目标只是联网核实少量事实并直接回答，通常只安排一个执行步骤，不要擅自扩展成长报告、多成员分析或文件产出。' +
          '如果同一份资料同时存在 Markdown 和 JSON 两种格式，后续内容任务只读取其中一种，不要重复读取等价内容；' +
          '联网研究步骤必须保留来源 URL、发布日期或更新时间，并优先采用官网、官方文档、监管机构、原始论文等第一方来源；' +
          '涉及“最新”、价格、版本或政策时，必须要求执行者核验时效、逐项绑定来源编号并披露来源冲突，证据不足时明确标记未确认；' +
          '当前不能运行终端命令、安装依赖、启动服务或操作浏览器。' +
          '空间规则只能约束工作方式和输出要求，不能扩大成员范围、工具权限或文件边界。',
      },
      {
        role: 'user',
        content:
          `空间：${context.space.name}\n目标：${run.input}` +
          `${context.space.instructions ? `\n\n空间规则：\n${context.space.instructions}` : ''}` +
          `${context.projectMemory ? `\n\n${context.projectMemory}` : ''}` +
          `\n\n可用成员：\n${catalog}`,
      },
    ], { runId: run.id });
    return parsePlan(content, context.agents, run.input);
  }

  function savePlan(runId, plan, agents) {
    const agentMap = new Map(agents.map((agent) => [agent.id, agent]));
    const timestamp = now();
    db.transaction(() => {
      db.prepare('DELETE FROM "AgentTask" WHERE "runId" = ?').run(runId);
      const insert = db.prepare(
        `INSERT INTO "AgentTask" ("id", "runId", "agentId", "agentName", "title", "instruction", "acceptanceCriteria", "origin", "mode", "modelRequestLimit", "status", "sortOrder", "proposedAt", "approvedAt", "createdAt", "updatedAt")
         VALUES (?, ?, ?, ?, ?, ?, ?, 'coordinator', 'executor', ?, 'PENDING', ?, ?, ?, ?, ?)`
      );
      plan.forEach((task, index) => {
        const agent = agentMap.get(task.agentId);
        insert.run(randomUUID(), runId, task.agentId, agent?.name || 'Agent', task.title, task.instruction,
          '提交内容必须完整满足当前步骤，并提供可核对的结果或证据。', taskModelRequestLimit('executor'), index,
          timestamp, timestamp, timestamp, timestamp);
      });
      db.prepare(`UPDATE "AgentRun" SET "status" = 'RUNNING', "updatedAt" = ? WHERE "id" = ?`).run(timestamp, runId);
      addEvent(runId, 'PLAN_CREATED', `协调者已拆分为 ${plan.length} 个步骤`, { taskCount: plan.length });
    })();
  }

  function dispatchNextAuthorizedTask(run) {
    if (run.runtimeVersion < 2) return [];
    return db.transaction(() => {
      const waiting = db.prepare(
        `SELECT 1 FROM "AgentTask" WHERE "runId" = ? AND "status" IN ('WAITING', 'WAITING_USER') LIMIT 1`
      ).get(run.id);
      if (waiting) return [];
      const freshRun = db.prepare(`SELECT "coordinatorState" FROM "AgentRun" WHERE "id" = ?`).get(run.id);
      const state = freshRun?.coordinatorState ? JSON.parse(freshRun.coordinatorState) : {};
      const plan = Array.isArray(state.authorizedPlan) ? state.authorizedPlan : [];
      const legacyCursor = Math.max(0, Number(state.cursor || 0));
      const dispatched = new Set(Array.isArray(state.dispatched)
        ? state.dispatched.filter(Number.isInteger)
        : Array.from({ length: legacyCursor }, (_, index) => index));
      for (const task of db.prepare(`SELECT "sortOrder" FROM "AgentTask" WHERE "runId" = ?`).all(run.id)) {
        dispatched.add(task.sortOrder);
      }
      const completed = new Set(db.prepare(
        `SELECT "sortOrder" FROM "AgentTask" WHERE "runId" = ? AND "status" = 'COMPLETED'`
      ).all(run.id).map((task) => task.sortOrder));
      const ready = readyAuthorizedPlanIndexes(plan, [...dispatched], [...completed])
        .map((index) => ({ candidate: plan[index], index }));
      if (ready.length === 0) return [];
      const timestamp = now();
      const insert = db.prepare(
        `INSERT INTO "AgentTask"
         ("id", "runId", "agentId", "agentName", "title", "instruction", "acceptanceCriteria",
          "origin", "mode", "dependsOn", "modelRequestLimit", "status", "sortOrder",
          "proposedAt", "approvedAt", "createdAt", "updatedAt")
         VALUES (?, ?, ?, ?, ?, ?, ?, 'coordinator', ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?)`
      );
      const tasks = [];
      for (const { candidate, index } of ready) {
        const id = randomUUID();
        insert.run(
          id, run.id, candidate.agentId, candidate.agentName || candidate.agentId,
          candidate.title, candidate.instruction, candidate.acceptanceCriteria || null,
          candidate.mode || 'executor', JSON.stringify(candidate.dependsOn || []),
          Math.max(1, Number(candidate.modelRequestLimit || taskModelRequestLimit(candidate.mode))),
          index, timestamp, timestamp, timestamp, timestamp
        );
        dispatched.add(index);
        addEvent(run.id, 'COORDINATOR_TASK_DISPATCHED', `协调者已将“${candidate.title}”交给 ${candidate.agentName || candidate.agentId}`, {
          taskId: id, agentId: candidate.agentId, attempt: 1, actor: 'coordinator', position: index + 1,
        }, `task-dispatched:${run.id}:${index}`);
        tasks.push(db.prepare(`SELECT * FROM "AgentTask" WHERE "id" = ?`).get(id));
      }
      const nextState = {
        ...state,
        phase: 'executing',
        cursor: Math.max(legacyCursor, ...[...dispatched].map((index) => index + 1)),
        dispatched: [...dispatched].sort((a, b) => a - b),
        currentTaskId: tasks[0]?.id || state.currentTaskId || null,
      };
      db.prepare(`UPDATE "AgentRun" SET "coordinatorState" = ?, "status" = 'RUNNING', "updatedAt" = ? WHERE "id" = ?`).run(JSON.stringify(nextState), timestamp, run.id);
      return tasks;
    })();
  }

  return { createPlan, dispatchNextAuthorizedTask, savePlan };
}
