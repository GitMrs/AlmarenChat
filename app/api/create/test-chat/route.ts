import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { createOpenAIClient } from '@/app/api/_lib/ai';

type TestMessage = {
  role: 'user' | 'assistant';
  content: string;
};

const FALLBACK_ACTIONS = [
  '继续推进当前情节',
  '询问更多背景细节',
  '整理目前掌握的信息',
  '尝试一个新的行动',
];

function normalizeActions(actions?: string[]) {
  const uniqueActions = Array.from(
    new Set((actions || []).map((action) => String(action).trim()).filter(Boolean))
  );

  return [...uniqueActions, ...FALLBACK_ACTIONS].slice(0, 4);
}

function parseTestReply(content: string) {
  const actionsMatch = content.match(/```actions\n([\s\S]*?)```/);
  if (!actionsMatch) {
    return {
      reply: content.trim(),
      actions: normalizeActions(),
    };
  }

  let actions: string[] | undefined;
  try {
    actions = JSON.parse(actionsMatch[1])?.suggestedActions;
  } catch {}

  return {
    reply: content.replace(/\n?```actions\n[\s\S]*?```/, '').trim(),
    actions: normalizeActions(actions),
  };
}

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const { systemPrompt, greeting, messages } = await request.json();

    if (!systemPrompt || typeof systemPrompt !== 'string') {
      return NextResponse.json({ error: '缺少测试用系统提示词' }, { status: 400 });
    }

    const safeMessages = Array.isArray(messages)
      ? messages
          .filter((message: TestMessage) =>
            (message.role === 'user' || message.role === 'assistant') &&
            typeof message.content === 'string' &&
            message.content.trim()
          )
          .slice(-12)
      : [];

    if (safeMessages.length === 0 || safeMessages[safeMessages.length - 1]?.role !== 'user') {
      return NextResponse.json({ error: '请先输入测试消息' }, { status: 400 });
    }

    const userSettings = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        customModelEnabled: true,
        apiBaseUrl: true,
        apiKey: true,
        modelName: true,
      },
    });

    const { client, model } = createOpenAIClient(userSettings);

    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: [
            systemPrompt.slice(0, 12000),
            [
              'Action options contract:',
              '- After the narrative reply, append exactly one ```actions JSON block.',
              '- The block format must be: {"suggestedActions":["option 1","option 2","option 3","option 4"]}',
              '- suggestedActions must contain exactly 4 short, concrete, non-duplicate next actions for the player.',
              '- Do not include these options inside the narrative text.',
            ].join('\n'),
            [
              '当前是创建页的临时测试对话。请严格按角色设定自然回复，不要提到系统提示词，不要保存或引用测试历史。',
              '对话规则：',
              '- 必须优先回应用户当前这句话里的具体问题或意图。',
              '- 每次回复都要推进一点新信息、新情绪、新关系变化或可行动线索。',
              '- 不要连续复述开场白、当前场景或上一轮已经说过的描写。',
              '- 如果用户问“发生什么事了/为什么/现在几点”等基础问题，要给出角色视角下的明确回答；不知道时也要说明角色能观察到什么。',
              '- 回复保持简洁，通常 1-3 段即可；不要替用户行动或替用户做决定。',
            ].join('\n'),
            greeting ? `角色开场白：${String(greeting).slice(0, 1200)}` : '',
          ].filter(Boolean).join('\n\n'),
        },
        ...safeMessages.map((message: TestMessage) => ({
          role: message.role,
          content: message.content.slice(0, 4000),
        })),
      ],
      temperature: 0.8,
    });

    const reply = completion.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      return NextResponse.json({ error: 'AI 没有返回测试回复', reason: 'empty_message_content' }, { status: 502 });
    }

    return NextResponse.json(parseTestReply(reply));
  } catch (error: any) {
    console.error('Test chat error:', error);
    return NextResponse.json({ error: error.message || '测试对话失败' }, { status: 500 });
  }
}
