import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { requireAuth } from '@/app/api/_lib/auth';

export async function POST(request: Request) {
  try {
    requireAuth(request);

    const { apiBaseUrl, apiKey, modelName } = await request.json();
    if (!apiBaseUrl || !apiKey || !modelName) {
      return NextResponse.json({ error: '请填写 Base URL、API Key 和模型名称' }, { status: 400 });
    }

    const client = new OpenAI({ baseURL: apiBaseUrl, apiKey });
    await client.chat.completions.create({
      model: modelName,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 8,
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
