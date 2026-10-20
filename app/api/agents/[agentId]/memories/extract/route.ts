import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { requireAgentMemoryAccess } from '@/app/api/_lib/agent-personal-memory';
import { loadAgentModelSetting, resolveUserModelConfig } from '@/app/api/_lib/agent-model';
import { createModelClient, resolveModelName } from '@/lib/model-client';
import { memoryFingerprint } from '@/lib/personal-assistant/memory-dedup.mjs';
import { explicitMemoryContent, explicitMemoryPrompt, parseExplicitMemory, shouldExtractMemorySuggestion } from '@/lib/personal-assistant/memory-intent.mjs';

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    await requireAgentMemoryAccess(userId, agentId);
    const body = await request.json();
    const conversation = await prisma.conversation.findFirst({ where: { id: String(body.conversationId || ''), userId, agentId, kind: 'AGENT', agentMode: 'MAIN' }, select: { id: true } });
    const userMessage = typeof body.userMessage === 'string' ? body.userMessage.trim().slice(0, 4_000) : '';
    if (!conversation || !shouldExtractMemorySuggestion(userMessage)) return NextResponse.json({ suggestions: [] });
    const explicit = explicitMemoryContent(userMessage);
    if (explicit !== null && (!explicit || explicit.length > 500 || /^(?:这个|那个|刚才的|上面说的)[。！!]?$/u.test(explicit))) return NextResponse.json({ suggestions: [] });
    const memories = await prisma.agentMemoryItem.findMany({ where: { userId, agentId, status: 'ACTIVE' }, orderBy: { updatedAt: 'desc' }, take: 60 });
    const modelMessages = [{ role: 'user' as const, content: explicit ? explicitMemoryPrompt(explicit) : [
      '提取当前用户明确表达、值得这个 Agent 长期记住的稳定偏好、习惯、背景或交互约定。',
      '只使用用户明确表达的事实；不把助理推测、一次性请求或虚构游戏内容当成用户事实。每条不超过100字；没有值得保留的信息就返回空数组。',
      `已有记忆：${memories.map(item => item.content).join('\n')}`,
      `用户原话：${userMessage}`,
      `助理回应（仅供理解上下文）：${String(body.assistantMessage || '').slice(0, 500)}`,
      '只输出 JSON：{"extracted":[{"content":"记忆内容","category":"preference|tech|rule|project|fact"}]}',
    ].join('\n\n') }];
    if (body.localOnly === true) return NextResponse.json({ suggestions: [], modelMessages });
    let raw = typeof body.localResponse === 'string' ? body.localResponse : '';
    if (typeof body.localResponse !== 'string') {
      const [user, setting] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId } }), loadAgentModelSetting(userId, agentId),
      ]);
      const config = resolveUserModelConfig(user, setting);
      try {
        const response = await createModelClient(config.apiBaseUrl, config.apiKey).chat.completions.create({ model: resolveModelName(config.modelName), messages: modelMessages, temperature: 0.1 }, { timeout: 15_000, maxRetries: 0 });
        raw = response.choices[0]?.message?.content || '';
      } catch (error) {
        if (!explicit) throw error;
      }
    }
    let candidates: Array<{ content: string; category?: string }> = [];
    if (explicit) candidates = [parseExplicitMemory(raw, explicit)];
    else {
      const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
      candidates = Array.isArray(parsed) ? parsed : Array.isArray(parsed.extracted) ? parsed.extracted : [];
    }
    const known = new Set(memories.map(item => memoryFingerprint(item.content)));
    const suggestions = candidates.filter(item => {
      if (typeof item?.content !== 'string' || !item.content.trim() || item.content.length > (explicit ? 500 : 100)) return false;
      const fingerprint = memoryFingerprint(item.content);
      if (!fingerprint || known.has(fingerprint)) return false;
      known.add(fingerprint);
      return true;
    }).slice(0, 3).map(item => ({ content: item.content.trim(), category: ['preference', 'tech', 'rule', 'project', 'fact'].includes(item.category || '') ? item.category : 'fact' }));
    return NextResponse.json({ suggestions });
  } catch (error: any) {
    if (error.message === 'Unauthorized' || error.message === 'Agent not found') return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : 404 });
    return NextResponse.json({ suggestions: [] });
  }
}
