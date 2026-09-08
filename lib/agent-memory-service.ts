import { randomUUID } from 'node:crypto';
import type { Prisma } from '@/src/generated/prisma/client';
import prisma from '@/app/api/_lib/db';
import { agentMemoryRuleKey, correctionMemoryCandidate } from '@/lib/agent-memory-policy.mjs';

function cleanText(value: unknown, limit: number) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function jsonStrings(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

export async function synchronizeAgentMemory(userId: string, agentId: string) {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, agentType: 'EMPLOYEE' },
    select: { id: true },
  });
  if (!agent) return;
  const [tasks, correctionEvents] = await Promise.all([
    prisma.agentTask.findMany({
      where: {
        agentId,
        status: 'COMPLETED',
        result: { not: null },
        run: { userId, status: 'COMPLETED' },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        title: true,
        result: true,
        mode: true,
        skillId: true,
        run: { select: { id: true, spaceId: true } },
      },
    }),
    prisma.agentRunEvent.findMany({
      where: {
        agentId,
        type: 'TASK_REVISION_REQUESTED',
        run: { userId },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, runId: true, taskId: true, payload: true, createdAt: true },
    }),
  ]);

  await prisma.$transaction(async (tx) => {
    for (const task of tasks) {
      await tx.agentExperience.upsert({
        where: { userId_agentId_taskId: { userId, agentId, taskId: task.id } },
        update: {
          spaceId: task.run.spaceId,
          runId: task.run.id,
          title: cleanText(task.title, 160),
          summary: cleanText(task.result, 2_000),
          outcome: 'ACCEPTED',
          tags: [task.mode, task.skillId].filter(Boolean),
        },
        create: {
          id: randomUUID(),
          userId,
          agentId,
          spaceId: task.run.spaceId,
          runId: task.run.id,
          taskId: task.id,
          title: cleanText(task.title, 160) || '未命名任务',
          summary: cleanText(task.result, 2_000),
          outcome: 'ACCEPTED',
          tags: [task.mode, task.skillId].filter(Boolean),
        },
      });
    }

    for (const event of correctionEvents) {
      const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
        ? event.payload as Record<string, unknown>
        : {};
      const candidate = correctionMemoryCandidate({
        feedback: payload.feedback,
        taskId: event.taskId,
        runId: event.runId,
      });
      if (!candidate) continue;
      const existing = await tx.agentMemoryRule.findUnique({
        where: { userId_agentId_key: { userId, agentId, key: candidate.key } },
      });
      const sourceIds = [...new Set([...jsonStrings(existing?.sourceIds), event.id, ...candidate.sourceIds])];
      if (existing) {
        if (jsonStrings(existing.sourceIds).includes(event.id)) continue;
        await tx.agentMemoryRule.update({
          where: { id: existing.id },
          data: { evidenceCount: { increment: 1 }, sourceIds },
        });
      } else {
        await tx.agentMemoryRule.create({
          data: {
            id: randomUUID(),
            userId,
            agentId,
            ...candidate,
            sourceIds,
            status: 'PENDING',
          },
        });
      }
    }
  });
}

export async function recordAgentCorrection(
  tx: Prisma.TransactionClient,
  options: { userId: string; agentId: string; taskId: string; runId: string; eventId: string; feedback: string }
) {
  const agent = await tx.agent.findFirst({
    where: { id: options.agentId, agentType: 'EMPLOYEE' },
    select: { id: true },
  });
  if (!agent) return;
  const candidate = correctionMemoryCandidate(options);
  if (!candidate) return;
  const existing = await tx.agentMemoryRule.findUnique({
    where: { userId_agentId_key: { userId: options.userId, agentId: options.agentId, key: candidate.key } },
  });
  const sourceIds = [...new Set([...jsonStrings(existing?.sourceIds), options.eventId, ...candidate.sourceIds])];
  if (existing) {
    if (jsonStrings(existing.sourceIds).includes(options.eventId)) return;
    await tx.agentMemoryRule.update({
      where: { id: existing.id },
      data: { evidenceCount: { increment: 1 }, sourceIds },
    });
    return;
  }
  await tx.agentMemoryRule.create({
    data: {
      id: randomUUID(),
      userId: options.userId,
      agentId: options.agentId,
      ...candidate,
      sourceIds,
      status: 'PENDING',
    },
  });
}

export function manualAgentMemoryRule(input: { category?: unknown; title?: unknown; instruction?: unknown }) {
  const category = ['method', 'correction', 'capability'].includes(String(input.category))
    ? String(input.category)
    : 'method';
  const title = cleanText(input.title, 120);
  const instruction = cleanText(input.instruction, 1_200);
  if (!title || !instruction) throw new Error('标题和经验内容不能为空');
  return { category, title, instruction, key: agentMemoryRuleKey(category, instruction) };
}
