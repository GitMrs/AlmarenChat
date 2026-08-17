import { NextResponse } from 'next/server';
import { Prisma } from '@/src/generated/prisma/client';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ACTIVE_AGENT_RUN_STATUSES, agentRunInclude } from '@/app/api/_lib/agent-runs';
import { getSpaceForUser, resolveManyAgents } from '@/app/api/_lib/spaces';
import { taskProposalNeedsClarification } from '@/lib/task-proposals';
import { coordinatorAuthorization } from '@/lib/agent-runtime-v3-policy.mjs';
import { taskProposalWithServerCapabilities } from '@/lib/task-proposal-policy.mjs';

type TaskProposalAttachment = {
  type: 'task_proposal';
  goal?: string;
  steps?: string[];
  deliverables?: string[];
  executionPlan?: unknown[];
  capabilities?: string[];
  status?: string;
  runId?: string;
  [key: string]: unknown;
};

type TaskProposalRevision = {
  goal: string;
  steps: string[];
  deliverables: string[];
  networkPolicy: 'forbidden' | 'allowed' | 'required';
};

function parseRevision(value: unknown): TaskProposalRevision | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object') throw new Error('修改后的任务方案无效');
  const input = value as Record<string, unknown>;
  const goal = typeof input.goal === 'string' ? input.goal.trim() : '';
  const list = (items: unknown, label: string) => {
    const normalized = Array.isArray(items)
      ? items.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)
      : [];
    if (normalized.length > 8) throw new Error(`${label}不能超过 8 项`);
    return normalized;
  };
  const steps = list(input.steps, '执行步骤');
  const networkPolicy = ['forbidden', 'allowed', 'required'].includes(String(input.networkPolicy || ''))
    ? input.networkPolicy as TaskProposalRevision['networkPolicy']
    : null;
  if (!goal || steps.length === 0) throw new Error('修改后的任务方案缺少目标或步骤');
  if (!networkPolicy) throw new Error('请选择联网策略');
  return { goal, steps, deliverables: list(input.deliverables, '预期产出'), networkPolicy };
}

function applyRevision(proposal: TaskProposalAttachment, revision: TaskProposalRevision | null) {
  const revisedExecutionPlan = revision && Array.isArray(proposal.executionPlan) && proposal.executionPlan.length === revision.steps.length
    ? proposal.executionPlan.map((value, index) => value && typeof value === 'object'
        ? {
            ...value,
            title: revision.steps[index],
            instruction: `${revision.goal}\n\n当前步骤：${revision.steps[index]}`,
            ...(index === revision.steps.length - 1 ? { deliverables: revision.deliverables } : {}),
          }
        : value)
    : revision ? undefined : proposal.executionPlan;
  let next = proposal;
  if (revision && revisedExecutionPlan) {
    const { capabilities: _capabilities, ...proposalWithoutCapabilities } = proposal;
    next = { ...proposalWithoutCapabilities, ...revision, executionPlan: revisedExecutionPlan };
  } else if (revision) {
    const { executionPlan: _legacyExecutionPlan, capabilities: _capabilities, ...authorizationProposal } = proposal;
    next = { ...authorizationProposal, ...revision };
  }
  const securedProposal = taskProposalWithServerCapabilities(next, {
    networkPolicyAuthoritative: Boolean(revision)
      || ['forbidden', 'allowed', 'required'].includes(String(next.networkPolicy || '')),
  }) as unknown as TaskProposalAttachment;
  const goal = typeof securedProposal.goal === 'string' ? securedProposal.goal.trim() : '';
  const steps = Array.isArray(securedProposal.steps) ? securedProposal.steps : [];
  if (taskProposalNeedsClarification(goal, steps)) {
    throw new Error('任务仍依赖用户补充信息，请先回到聊天中确认关键输入。');
  }
  return securedProposal;
}

function taskProposalFromAttachments(attachments: unknown) {
  if (!Array.isArray(attachments)) return null;
  return (attachments.find(
    (attachment) => attachment && typeof attachment === 'object' && (attachment as TaskProposalAttachment).type === 'task_proposal'
  ) as TaskProposalAttachment | undefined) || null;
}

function taskInput(proposal: TaskProposalAttachment, fallback: string) {
  const goal = typeof proposal.goal === 'string' ? proposal.goal.trim() : fallback;
  const steps = Array.isArray(proposal.steps) ? proposal.steps.filter((step): step is string => typeof step === 'string' && Boolean(step.trim())) : [];
  const deliverables = Array.isArray(proposal.deliverables)
    ? proposal.deliverables.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : [];
  return [
    goal,
    steps.length > 0 ? `\n已授权里程碑：\n${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}` : '',
    deliverables.length > 0 ? `\n预期产出：\n${deliverables.map((item) => `- ${item}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    const runs = await prisma.agentRun.findMany({
      where: { spaceId, userId },
      include: agentRunInclude,
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return NextResponse.json({ runs });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const { input, proposalMessageId, revisedProposal } = await request.json();
    const revision = parseRevision(revisedProposal);
    let goal = typeof input === 'string' ? input.trim() : '';
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    if (space.members.length === 0) {
      return NextResponse.json({ error: '请先向空间添加至少一个 Agent' }, { status: 400 });
    }
    const memberAgents = await resolveManyAgents(space.members.map((member) => member.agentId), userId);
    if (memberAgents.length === 0) return NextResponse.json({ error: '空间成员不可用' }, { status: 400 });
    let proposalMessage = null;
    let proposal: TaskProposalAttachment | null = null;
    if (typeof proposalMessageId === 'string' && proposalMessageId) {
      proposalMessage = await prisma.spaceMessage.findFirst({ where: { id: proposalMessageId, spaceId } });
      proposal = taskProposalFromAttachments(proposalMessage?.attachments);
      if (!proposalMessage || !proposal) return NextResponse.json({ error: 'Task proposal not found' }, { status: 404 });
      if (proposal.status === 'rejected') return NextResponse.json({ error: 'Task proposal was rejected' }, { status: 409 });
      if (proposal.status === 'approved' && proposal.runId) {
        const existing = await prisma.agentRun.findFirst({ where: { id: proposal.runId, spaceId, userId }, include: agentRunInclude });
        if (existing) return NextResponse.json({ run: existing });
      }
      proposal = applyRevision(proposal, revision);
      goal = taskInput(proposal, goal);
    }
    if (!goal) return NextResponse.json({ error: '任务目标不能为空' }, { status: 400 });
    if (goal.length > 12_000) return NextResponse.json({ error: '任务目标不能超过 12000 字' }, { status: 400 });

    const activeRun = await prisma.agentRun.findFirst({
      where: { spaceId, userId, status: { in: ACTIVE_AGENT_RUN_STATUSES } },
      select: { id: true },
    });
    if (activeRun) {
      return NextResponse.json({ error: '空间中已有任务正在运行' }, { status: 409 });
    }

    const run = await prisma.$transaction(async (tx) => {
      const concurrentActiveRun = await tx.agentRun.findFirst({
        where: { spaceId, userId, status: { in: ACTIVE_AGENT_RUN_STATUSES } },
        select: { id: true },
      });
      if (concurrentActiveRun) throw new Error('空间中已有任务正在运行');

      let currentProposalMessage = proposalMessage;
      let currentProposal = proposal;
      let runInput = goal;
      if (proposalMessage) {
        currentProposalMessage = await tx.spaceMessage.findFirst({ where: { id: proposalMessage.id, spaceId } });
        currentProposal = taskProposalFromAttachments(currentProposalMessage?.attachments);
        if (!currentProposalMessage || !currentProposal) throw new Error('任务方案不存在');
        if (currentProposal.status !== 'pending') throw new Error('任务方案已经处理');
        currentProposal = applyRevision(currentProposal, revision);
        runInput = taskInput(currentProposal, goal);
      }

      const currentMemberIds = new Set((await tx.spaceMember.findMany({
        where: { spaceId },
        select: { agentId: true },
      })).map((member) => member.agentId));
      const currentMemberAgents = memberAgents.filter((agent) => currentMemberIds.has(agent.id));
      if (currentMemberAgents.length === 0) throw new Error('空间成员不可用');
      const authorization = coordinatorAuthorization(currentProposal || {
        goal: runInput,
        steps: [runInput],
        deliverables: [],
        artifacts: [],
      });
      const modelRequestLimit = 48;

      const created = await tx.agentRun.create({
        data: {
          spaceId,
          userId,
          input: runInput,
          runtimeVersion: 3,
          eventSequence: 1,
          coordinatorState: {
            phase: 'coordinating',
            authorizedAt: new Date().toISOString(),
            iteration: 0,
            taskCount: 0,
            currentTaskIds: [],
            authorization,
          },
          modelRequestLimit,
          events: {
            create: {
              type: 'RUN_QUEUED',
              message: '目标授权已确认，等待协调者安排工作',
              sequence: 1,
              actor: 'user',
              payload: {
                taskCount: 0,
                modelRequestLimit,
                authorization,
              },
            },
          },
        },
        include: agentRunInclude,
      });
      if (currentProposalMessage && currentProposal) {
        const attachments = (currentProposalMessage.attachments as unknown[]).map((attachment) =>
          attachment && typeof attachment === 'object' && (attachment as TaskProposalAttachment).type === 'task_proposal'
            ? { ...currentProposal, status: 'approved', runId: created.id }
            : attachment
        );
        await tx.spaceMessage.update({
          where: { id: currentProposalMessage.id },
          data: { attachments: attachments as Prisma.InputJsonValue },
        });
      }
      return { run: created, proposal: currentProposal || undefined };
    });
    return NextResponse.json(run, { status: 201 });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
