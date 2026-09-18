import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import prisma from '@/app/api/_lib/db';
import { createModelClient, DEFAULT_BASE_URL, DEFAULT_MODEL } from '@/lib/model-client';

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!name) return NextResponse.json({ error: '请先填写空间名称' }, { status: 400 });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { customModelEnabled: true, apiBaseUrl: true, apiKey: true, modelName: true },
    });
    if (!user) throw new Error('Unauthorized');

    const client = createModelClient(
      user.customModelEnabled ? user.apiBaseUrl : DEFAULT_BASE_URL,
      user.customModelEnabled ? user.apiKey : process.env.apiKey,
    );
    const completion = await client.chat.completions.create({
      model: user.customModelEnabled && user.modelName ? user.modelName : DEFAULT_MODEL,
      temperature: 0.3,
      messages: [
        { role: 'system', content: '你负责为 AI 工作空间生成简洁、可执行的空间规则。只输出 3 到 6 条编号规则，每条一行；不要输出标题、解释、Markdown 代码块或免责声明。规则应围绕目标、输出质量、确认边界和工具使用，避免重复描述用户输入。' },
        { role: 'user', content: `空间名称：${name}\n空间描述：${description || '用户尚未提供详细描述，请根据名称推断一个通用工作目标。'}` },
      ],
      stream: false,
    });
    const instructions = String(completion.choices?.[0]?.message?.content || '').trim();
    if (!instructions) return NextResponse.json({ error: '模型没有生成有效规则' }, { status: 502 });
    return NextResponse.json({ instructions: instructions.slice(0, 12_000) });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message || '生成空间规则失败' }, { status: 500 });
  }
}
