import prisma from '@/app/api/_lib/db';

export const DEFAULT_ASSISTANT_NAME = '小伴';
export const DEFAULT_ASSISTANT_GREETING = '我在。想随便聊聊，还是一起看看最近有什么要处理？';

export async function ensurePersonalAssistant(userId: string) {
  const existing = await prisma.personalAssistantProfile.findUnique({
    where: { userId },
    include: { conversation: true },
  });
  if (existing) return existing;

  try {
    return await prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.create({
        data: { userId, kind: 'PERSONAL_ASSISTANT', title: '我的助理' },
      });
      return tx.personalAssistantProfile.create({
        data: {
          userId,
          conversationId: conversation.id,
          name: DEFAULT_ASSISTANT_NAME,
          greeting: DEFAULT_ASSISTANT_GREETING,
        },
        include: { conversation: true },
      });
    });
  } catch {
    const raced = await prisma.personalAssistantProfile.findUnique({
      where: { userId },
      include: { conversation: true },
    });
    if (raced) return raced;
    throw new Error('无法初始化个人助理');
  }
}
