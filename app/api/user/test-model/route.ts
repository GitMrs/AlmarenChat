import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import { resolveModelRequestConfig } from '@/app/api/_lib/model-request';
import { createModelClient } from '@/lib/model-client';

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);

    const body = await request.json().catch(() => ({}));
    const { apiBaseUrl, apiKey, modelName } = await resolveModelRequestConfig(userId, body);

    if (!modelName) {
      return NextResponse.json({ error: '请先填写或选择模型名称' }, { status: 400 });
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
      { status: e.message === 'Unauthorized' ? 401 : e.status || 500 }
    );
  }
}
