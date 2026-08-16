import type { Prisma } from '@/src/generated/prisma/client';

type EventInput = Omit<Prisma.AgentRunEventUncheckedCreateInput, 'runId' | 'sequence'>;

export async function appendAgentRunEvent(
  transaction: Prisma.TransactionClient,
  runId: string,
  data: EventInput
) {
  const run = await transaction.agentRun.update({
    where: { id: runId },
    data: { eventSequence: { increment: 1 } },
    select: { eventSequence: true },
  });
  return transaction.agentRunEvent.create({
    data: { ...data, runId, sequence: run.eventSequence },
  });
}
