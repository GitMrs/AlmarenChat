import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import { resolveModelRequestConfig } from '@/app/api/_lib/model-request';
import { createModelClient } from '@/lib/core/model-client';

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json().catch(() => ({}));
    const { apiBaseUrl, apiKey } = await resolveModelRequestConfig(userId, body);

    if (!apiBaseUrl || !apiKey) {
      return NextResponse.json({ error: '请先填写 Base URL 和 API Key，或在个人中心配置全局凭据' }, { status: 400 });
    }

    const result = await createModelClient(apiBaseUrl, apiKey).models.list();
    const models = [...new Set(
      result.data
        .map((model) => String(model.id || '').trim())
        .filter(Boolean)
    )].sort((left, right) => left.localeCompare(right));

    return NextResponse.json({ models });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      { error: error.message || '获取模型列表失败，请检查 Base URL 和 API Key' },
      { status: error.status || 500 }
    );
  }
}
