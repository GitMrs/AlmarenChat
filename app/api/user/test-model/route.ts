import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import prisma from '@/app/api/_lib/db';
import { createModelClient } from '@/lib/model-client';

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);

    const body = await request.json().catch(() => ({}));
    let apiBaseUrl = typeof body?.apiBaseUrl === 'string' ? body.apiBaseUrl.trim() : '';
    let apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
    const modelName = typeof body?.modelName === 'string' ? body.modelName.trim() : '';

    if (!modelName) {
      return NextResponse.json({ error: '请先填写或选择模型名称' }, { status: 400 });
    }

    if (!apiBaseUrl || !apiKey) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!apiBaseUrl && user?.apiBaseUrl) apiBaseUrl = user.apiBaseUrl.trim();
      if (!apiKey && user?.apiKey) apiKey = user.apiKey.trim();
      if (!apiKey && process.env.apiKey) apiKey = process.env.apiKey.trim();
    }

    if (!apiBaseUrl || !apiKey) {
      return NextResponse.json({ error: '请填写 Base URL 和 API Key，或在个人中心配置全局凭据' }, { status: 400 });
    }

    const client = createModelClient(apiBaseUrl, apiKey);
    await client.chat.completions.create({
      model: modelName,
      messages: [{ role: 'user', content: 'ping' }],
      stream: false,
    });

    return NextResponse.json({ ok: true, message: '连接成功' });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || '连接失败，请检查配置' },
      { status: 500 }
    );
  }
}
