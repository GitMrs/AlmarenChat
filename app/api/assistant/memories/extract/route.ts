import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { createModelClient, resolveModelName } from '@/lib/model-client';

export const runtime = 'nodejs';

const TRIVIAL_INPUTS = new Set([
  '你好', '您好', '在吗', '在不在', '嗨', 'hello', 'hi', 'hey',
  '谢谢', '多谢', '感谢', '好的', '好的谢谢', '收到', '明白', 'ok',
  '行', '可以', '恩', '嗯', '对', '是的', '不是', '再见', '拜拜',
]);

function isTrivial(text: string): boolean {
  const cleaned = text.trim().toLowerCase().replace(/[！!？?。，,~～\s]+/g, '');
  if (!cleaned || cleaned.length < 3) return true;
  return TRIVIAL_INPUTS.has(cleaned);
}

function extractJsonArray(raw: string): Array<{ content: string; category?: string }> {
  try {
    const cleaned = raw.replace(/```json\s*|```/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    const list = Array.isArray(parsed) ? parsed : (parsed.extracted || parsed.memories || parsed.suggestions || []);
    if (!Array.isArray(list)) return [];
    return list
      .map((item: any) => {
        const content = typeof item === 'string' ? item : (typeof item?.content === 'string' ? item.content : '');
        const category = typeof item?.category === 'string' ? item.category : 'preference';
        return { content: content.trim(), category };
      })
      .filter((item) => item.content.length >= 3 && item.content.length <= 100);
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json();
    const mode: 'single' | 'conversation' = body.mode === 'conversation' ? 'conversation' : 'single';

    let dialogueContext = '';

    if (mode === 'single') {
      const userMsg = typeof body.userMessage === 'string' ? body.userMessage.trim() : '';
      const assistantMsg = typeof body.assistantMessage === 'string' ? body.assistantMessage.trim() : '';
      if (!userMsg || isTrivial(userMsg)) {
        return NextResponse.json({ suggestions: [] });
      }
      dialogueContext = `用户说：${userMsg}\n助理回复：${assistantMsg.slice(0, 300)}`;
    } else {
      const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
      if (!conversationId) return NextResponse.json({ suggestions: [] });

      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, userId, kind: 'PERSONAL_ASSISTANT' },
        select: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 16,
            select: { role: true, content: true },
          },
        },
      });
      if (!conversation) return NextResponse.json({ error: '会话不存在' }, { status: 404 });

      const messages = conversation.messages;
      if (messages.length < 2) return NextResponse.json({ suggestions: [] });

      dialogueContext = messages
        .reverse()
        .map((m) => `${m.role === 'user' ? '用户' : '助理'}：${m.content.slice(0, 300)}`)
        .join('\n');
    }

    const existingMemories = await prisma.assistantMemoryItem.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { content: true },
      take: 40,
    });

    const existingListStr = existingMemories.length > 0
      ? existingMemories.map((m) => `- ${m.content}`).join('\n')
      : '（暂无已记录的记忆）';

    const prompt = `你是一个温暖、克制、敏锐的专属陪伴助理记忆提炼器。
请分析以下对话，判断用户是否明确表达了【长期有效、值得专属陪伴助理长期记住】的个人偏好、生活习惯、工作技术栈或关键背景事实。

【提取准则】：
1. 必须是关于用户的长期个人事实（例如：“平时喝咖啡不加糖”、“写代码习惯用 TypeScript”、“养了一只英短猫”、“做 AlmarenChat 项目”）。
2. 严禁提取临时性、一次性的问题或指令（例如：“帮我查下天气”、“这行代码报错怎么改”、“翻译这句话”）。
3. 绝对不要重复提取用户已经存在的记忆！
4. 语言必须精炼（一句话，10~30个字以内，客观描述，如：“平时喝咖啡习惯不加糖”）。
5. 如果对话中没有任何值得长期记忆的个人信息，提取结果必须为空数组 []。

【用户已有记忆库】：
${existingListStr}

【待分析对话】：
${dialogueContext}

请直接输出合法 JSON，不要加任何解释或其他字符：
{
  "extracted": [
    {
      "content": "提取的事实内容",
      "category": "preference"
    }
  ]
}`;

    const modelMessages = [{ role: 'user' as const, content: prompt }];
    const hasLocalResponse = typeof body.localResponse === 'string';
    let rawResponse = hasLocalResponse ? body.localResponse : '';

    if (!hasLocalResponse && body.localOnly === true) {
      return NextResponse.json({ suggestions: [], modelMessages });
    }

    if (!hasLocalResponse) {
      const userSettings = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          customModelEnabled: true,
          apiBaseUrl: true,
          apiKey: true,
          modelName: true,
        },
      });
      const usesCustomModel = Boolean(
        userSettings?.customModelEnabled && userSettings.apiBaseUrl && userSettings.apiKey && userSettings.modelName
      );
      const client = createModelClient(
        usesCustomModel ? userSettings?.apiBaseUrl : undefined,
        usesCustomModel ? userSettings?.apiKey : undefined
      );
      const model = resolveModelName(usesCustomModel ? userSettings?.modelName : undefined);
      const completion = await client.chat.completions.create({
        model,
        messages: modelMessages,
        temperature: 0.1,
      });
      rawResponse = completion.choices[0]?.message?.content || '';
    }

    const rawSuggestions = extractJsonArray(rawResponse);

    // Filter out items already recorded or similar
    const existingSet = new Set(existingMemories.map((m) => m.content.trim().toLowerCase()));
    const finalSuggestions = rawSuggestions.filter(
      (item) => !existingSet.has(item.content.toLowerCase())
    );

    return NextResponse.json({ suggestions: finalSuggestions.slice(0, 3) });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ suggestions: [] });
  }
}
