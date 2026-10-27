import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { agentChatArchiveState, archiveAgentChat, requireAgentMemoryAccess } from '@/app/api/_lib/agent-personal-memory';
import { loadAgentMemoryContext } from '@/lib/agents/memory/agent-memory';
import { estimateMessagesTokens } from '@/lib/agents/memory/context-compression';
import { createModelClient, resolveModelName } from '@/lib/core/model-client';
import { loadAgentModelSetting, resolveUserModelConfig } from '@/app/api/_lib/agent-model';

type Params = { params: Promise<{ conversationId: string }> };

async function ownedConversation(request: Request, params: Params['params']) {
  const userId = requireAuth(request);
  const { conversationId } = await params;
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, userId, kind: 'AGENT' } });
  if (!conversation?.agentId) throw new Error('Conversation not found');
  await requireAgentMemoryAccess(userId, conversation.agentId);
  return { userId, conversation, agentId: conversation.agentId, conversationId };
}

function failure(error: Error) {
  return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : /not found/.test(error.message) ? 404 : error.message.includes('已更新') ? 409 : 500 });
}

export async function GET(request: Request, { params }: Params) {
  try {
    const { userId, conversation, agentId, conversationId } = await ownedConversation(request, params);
    const state = await agentChatArchiveState(userId, agentId, conversationId);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { contextMessageLimit: true } });
    const contextLimit = Math.max(1, Math.min(80, conversation.contextMessageLimit || user?.contextMessageLimit || 40));
    const [totalCount, unarchivedCount, recent, experiences, experiencesCount, lastQuestion] = await Promise.all([
      prisma.message.count({ where: { conversationId, role: { in: ['user', 'assistant'] } } }),
      prisma.message.count({ where: state.where }),
      prisma.message.findMany({ where: state.where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: contextLimit, select: { id: true, role: true, content: true, createdAt: true } }),
      prisma.agentExperience.findMany({ where: { userId, agentId, sourceType: 'CHAT', taskId: { startsWith: state.prefix }, status: { not: 'DELETED' } }, orderBy: { createdAt: 'desc' }, take: 30 }),
      prisma.agentExperience.count({ where: { userId, agentId, sourceType: 'CHAT', taskId: { startsWith: state.prefix }, status: { not: 'DELETED' } } }),
      prisma.message.findFirst({ where: { conversationId, role: 'user' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { content: true } }),
    ]);
    const memoryContext = conversation.agentMode === 'MAIN'
      ? await loadAgentMemoryContext({ userId, agentId, query: (lastQuestion?.content || '').slice(0, 4_000) }) : '';
    return NextResponse.json({
      conversationId, conversationMode: conversation.agentMode, contextLimit,
      totalCount, unarchivedCount, archivedCount: totalCount - unarchivedCount,
      estimatedTokens: estimateMessagesTokens(recent), recentContextTokens: estimateMessagesTokens(recent), recentContextCount: recent.length,
      archiveTrigger: 64, autoPreserveRecent: 16, experiencesCount, memoryContext,
      canArchive: conversation.agentMode === 'MAIN' && unarchivedCount > 2,
      experiences: experiences.map(item => {
        const tags = Array.isArray(item.tags) ? item.tags.map(String) : [];
        return { id: item.id, summary: item.summary, messageCount: tags.filter(tag => tag.startsWith('message:')).length,
          startAt: tags.find(tag => tag.startsWith('from-time:'))?.slice(10) || item.createdAt.toISOString(),
          endAt: tags.find(tag => tag.startsWith('through-time:'))?.slice(13) || item.createdAt.toISOString(), createdAt: item.createdAt.toISOString() };
      }),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error as Error); }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { userId, conversation, agentId, conversationId } = await ownedConversation(request, params);
    if (conversation.agentMode !== 'MAIN') return NextResponse.json({ error: '临时聊天不写入长期对话归档' }, { status: 400 });
    const body = await request.json();
    const preserveRecent = Number(body.preserveRecent ?? 4);
    if (!Number.isInteger(preserveRecent) || preserveRecent < 2 || preserveRecent > 20) return NextResponse.json({ error: '保留条数需为2～20的整数' }, { status: 400 });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { customModelEnabled: true, apiBaseUrl: true, apiKey: true, modelName: true } });
    const setting = await loadAgentModelSetting(userId, agentId);
    const config = resolveUserModelConfig(user, setting);
    const result = await archiveAgentChat(userId, agentId, conversationId, {
      preserveRecent,
      summarize: async prompt => {
        const client = createModelClient(config.apiBaseUrl, config.apiKey);
        const completion = await client.chat.completions.create({ model: resolveModelName(config.modelName), messages: [{ role: 'user', content: prompt }], temperature: 0.1 }, { timeout: 25_000, maxRetries: 0 });
        return completion.choices[0]?.message?.content || null;
      },
    });
    if (!result) return NextResponse.json({ error: '没有可归档的早期对话，请保留更少条数或稍后再试' }, { status: 400 });
    const { experience, ...counts } = result;
    const tags = Array.isArray(experience.tags) ? experience.tags.map(String) : [];
    return NextResponse.json({ ...counts, experience: { id: experience.id, summary: experience.summary, messageCount: counts.archivedCount, startAt: tags.find(tag => tag.startsWith('from-time:'))?.slice(10) || experience.createdAt.toISOString(), endAt: experience.createdAt.toISOString(), createdAt: experience.createdAt.toISOString() } });
  } catch (error) { return failure(error as Error); }
}
