import prisma from '@/app/api/_lib/db';
import { explicitMemoryContent, memoryConfirmation } from './memory-intent.mjs';
import { isDuplicateMemory } from './memory-dedup.mjs';

export async function handleQQMemoryRequest(options: {
  userId: string;
  conversationId: string;
  message: string;
  userMessageId: string;
  assistantMessageId: string;
  normalize: (content: string) => Promise<{ content: string; category: string }>;
}) {
  const { userId, conversationId, message, userMessageId, assistantMessageId } = options;
  const requested = explicitMemoryContent(message);
  const decision = memoryConfirmation(message);
  const candidate = requested && requested.length <= 500 && !/^(?:这个|那个|刚才的|上面说的)[。！!]?$/u.test(requested)
    ? await options.normalize(requested)
    : null;

  return prisma.$transaction(async (tx) => {
    const replay = await tx.message.findUnique({ where: { id: assistantMessageId } });
    if (replay) return replay.content;
    const pending = await tx.assistantMemoryItem.findFirst({
      where: { userId, agentId: null, status: 'PENDING_QQ' },
      orderBy: { createdAt: 'desc' },
    });
    const latest = await tx.message.findFirst({
      where: { conversationId }, orderBy: { createdAt: 'desc' },
    });
    const canConfirm = pending && latest?.id === pending.sourceMessageId
      && latest.source === 'QQ' && Date.now() - pending.createdAt.getTime() < 30 * 60_000;
    let reply: string | null = null;

    if (requested !== null) {
      if (!requested || /^(?:这个|那个|刚才的|上面说的)[。！!]?$/u.test(requested)) {
        reply = '你希望我长期记住什么？请说“帮我记一下：具体内容”。';
      } else if (requested.length > 500) {
        reply = '这段内容超过500字，请缩短后再让我记住。';
      } else if (candidate) {
        reply = `准备存入长期记忆：\n${candidate.content}\n\n回复“确认保存”后才会保存，回复“取消”则不保存。继续其他话题会取消本次确认。`;
      }
    } else if (decision && pending && !canConfirm) {
      reply = '这次长期记忆确认已失效，请重新告诉我要记住的具体内容。';
    } else if (decision && canConfirm) {
      if (decision === 'cancel') {
        reply = '已取消，没有存入长期记忆。';
      } else {
        const existing = await tx.assistantMemoryItem.findMany({
          where: { userId, agentId: null, status: 'ACTIVE' }, select: { content: true },
        });
        const duplicate = isDuplicateMemory(pending.content, existing.map((item) => item.content));
        if (!duplicate) {
          await tx.assistantMemoryItem.update({ where: { id: pending.id }, data: { status: 'ACTIVE' } });
        }
        reply = `${duplicate ? '长期记忆中已有' : '已存入长期记忆'}：${pending.content}`;
      }
    }

    // Pending candidates are never supplied to the model as confirmed memories.
    await tx.assistantMemoryItem.deleteMany({ where: { userId, agentId: null, status: 'PENDING_QQ' } });
    if (reply === null) return null;
    if (candidate) {
      await tx.assistantMemoryItem.create({ data: {
        userId, agentId: null, ...candidate, status: 'PENDING_QQ', sourceMessageId: assistantMessageId,
      } });
    }
    await tx.message.create({ data: { id: userMessageId, conversationId, role: 'user', source: 'QQ', content: message } });
    await tx.message.create({ data: { id: assistantMessageId, conversationId, role: 'assistant', source: 'QQ', content: reply } });
    await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    return reply;
  });
}
