import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { resolveUserModelConfig } from '@/app/api/_lib/agent-model';
import { createModelClient } from '@/lib/core/model-client';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : '';
    const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 2000) : '';
    if (!name && !description) {
      return NextResponse.json({ error: '请先填写角色名称或卡片简介。' }, { status: 400 });
    }

    const settings = await prisma.user.findUnique({
      where: { id: userId },
      select: { customModelEnabled: true, apiBaseUrl: true, apiKey: true, modelName: true },
    });
    const config = resolveUserModelConfig(settings);
    const client = createModelClient(config.apiBaseUrl, config.apiKey);
    const completion = await client.chat.completions.create({
      model: config.modelName,
      messages: [
        {
          role: 'system',
          content: '根据用户提供的角色名称和简介，为聊天 Agent 起草一段可直接使用的中文系统提示词。写清角色身份、性格和交流方式。以用户提供的设定为准，信息不足时少作假定，不编造背景或能力。直接输出提示词正文，不加解释、代码块或分类标签。',
        },
        { role: 'user', content: JSON.stringify({ name, description }) },
      ],
      max_tokens: 1000,
    }, { signal: request.signal, timeout: 45_000, maxRetries: 0 });
    const systemPrompt = completion.choices[0]?.message?.content?.trim()
      .replace(/^```[^\r\n]*\r?\n([\s\S]*?)\r?\n```$/, '$1').trim();
    if (!systemPrompt) {
      return NextResponse.json({ error: '模型没有返回角色设定，请重试。' }, { status: 502 });
    }

    return NextResponse.json({ systemPrompt });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: '请登录后再生成。' }, { status: 401 });
    }
    return NextResponse.json({ error: '角色设定生成失败，请稍后重试。' }, { status: 500 });
  }
}
