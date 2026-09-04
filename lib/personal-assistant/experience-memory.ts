import { randomUUID } from 'node:crypto';
import prisma from '@/app/api/_lib/db';

export const EXPERIENCE_ARCHIVE_TRIGGER = 64;
export const EXPERIENCE_ARCHIVE_BATCH = 48;
const EXPERIENCE_CONTEXT_LIMIT = 12;

type RawMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
};

type Summarizer = (prompt: string) => Promise<string | null>;

function compactText(value: string, limit: number) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, limit)}...` : compact;
}

export function buildExperiencePrompt(messages: RawMessage[]) {
  const transcript = messages.map((message) => (
    `${message.role === 'user' ? '用户' : '助理'}：${compactText(message.content, 1200)}`
  )).join('\n');
  return `请把下面一段个人助理对话压缩成一份可长期延续关系的“经历摘要”。

要求：
1. 只记录真实发生的对话、用户明确表达的信息、已经形成的结论和仍未解决的事项。
2. 不要把推测写成事实，不要新增建议，不要复述寒暄。
3. 使用第三人称客观表达，保留重要人名、项目名、数字和时间。
4. 控制在 300~800 个中文字符，直接输出 Markdown 列表，不要标题或代码块。

对话：
${transcript}`;
}

export function buildDeterministicExperienceSummary(messages: RawMessage[]) {
  const lines = messages
    .filter((message) => message.content.trim())
    .map((message) => `- ${message.role === 'user' ? '用户提到' : '助理回应'}：${compactText(message.content, 220)}`);
  return lines.join('\n').slice(0, 6000);
}

export async function archiveOldMainChatMessages(options: {
  userId: string;
  conversationId: string;
  summarize?: Summarizer;
}) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: options.conversationId,
      userId: options.userId,
      kind: 'PERSONAL_ASSISTANT',
      assistantMode: 'MAIN',
    },
    select: { id: true },
  });
  if (!conversation) return null;

  const unarchivedCount = await prisma.message.count({
    where: {
      conversationId: options.conversationId,
      assistantExperienceId: null,
      role: { in: ['user', 'assistant'] },
    },
  });
  if (unarchivedCount < EXPERIENCE_ARCHIVE_TRIGGER) return null;

  const candidates = await prisma.message.findMany({
    where: {
      conversationId: options.conversationId,
      assistantExperienceId: null,
      role: { in: ['user', 'assistant'] },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: EXPERIENCE_ARCHIVE_BATCH,
    select: { id: true, role: true, content: true, createdAt: true },
  });
  if (candidates.length < EXPERIENCE_ARCHIVE_BATCH) return null;

  let summary = '';
  if (options.summarize) {
    try {
      summary = compactText((await options.summarize(buildExperiencePrompt(candidates))) || '', 6000);
    } catch {
      summary = '';
    }
  }
  if (!summary) summary = buildDeterministicExperienceSummary(candidates);
  if (!summary) return null;

  const experienceId = randomUUID();
  try {
    return await prisma.$transaction(async (tx) => {
      const experience = await tx.assistantExperience.create({
        data: {
          id: experienceId,
          userId: options.userId,
          conversationId: options.conversationId,
          summary,
          messageCount: candidates.length,
          startAt: candidates[0].createdAt,
          endAt: candidates[candidates.length - 1].createdAt,
        },
      });
      const claimed = await tx.message.updateMany({
        where: {
          id: { in: candidates.map((message) => message.id) },
          conversationId: options.conversationId,
          assistantExperienceId: null,
        },
        data: { assistantExperienceId: experienceId },
      });
      if (claimed.count !== candidates.length) throw new Error('经历归档已被其他请求处理');
      return experience;
    });
  } catch (error: any) {
    if (error?.message === '经历归档已被其他请求处理') return null;
    throw error;
  }
}

function queryTerms(query: string) {
  const normalized = query.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const terms = new Set<string>();
  for (const word of query.toLowerCase().match(/[a-z0-9][a-z0-9._-]{1,}/g) || []) terms.add(word);
  for (let index = 0; index < normalized.length - 1 && terms.size < 24; index += 1) {
    terms.add(normalized.slice(index, index + 2));
  }
  return [...terms];
}

export async function loadAssistantMemoryContext(options: {
  userId: string;
  conversationId: string;
  query: string;
  historyLimit: number;
  includeExperiences: boolean;
}) {
  const [history, experiencePool] = await Promise.all([
    prisma.message.findMany({
      where: {
        conversationId: options.conversationId,
        ...(options.includeExperiences ? { assistantExperienceId: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: options.historyLimit,
      select: { role: true, content: true },
    }),
    options.includeExperiences
      ? prisma.assistantExperience.findMany({
          where: { userId: options.userId, conversationId: options.conversationId },
          orderBy: { endAt: 'desc' },
          take: 120,
          select: { id: true, summary: true, messageCount: true, startAt: true, endAt: true },
        })
      : Promise.resolve([]),
  ]);

  const terms = queryTerms(options.query);
  const recent = experiencePool.slice(0, 6);
  const relevant = experiencePool
    .map((experience) => ({
      experience,
      score: terms.reduce((score, term) => score + (experience.summary.toLowerCase().includes(term) ? 1 : 0), 0),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.experience.endAt.getTime() - left.experience.endAt.getTime())
    .slice(0, 6)
    .map((item) => item.experience);
  const selected = [...new Map([...recent, ...relevant].map((item) => [item.id, item])).values()]
    .slice(0, EXPERIENCE_CONTEXT_LIMIT)
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime());

  const experienceContext = selected.length
    ? selected.map((item) => {
        const start = item.startAt.toISOString().slice(0, 10);
        const end = item.endAt.toISOString().slice(0, 10);
        return `[${start}${start === end ? '' : ` 至 ${end}`}，${item.messageCount} 条消息]\n${item.summary}`;
      }).join('\n\n')
    : '';

  return { history: history.reverse(), experienceContext };
}
