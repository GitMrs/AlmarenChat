import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import { createModelClient } from '@/lib/model-client';

export async function POST(request: Request) {
  try {
    requireAuth(request);
    const { apiBaseUrl, apiKey } = await request.json();
    if (!apiBaseUrl || !apiKey) {
      return NextResponse.json({ error: '请先填写 Base URL 和 API Key' }, { status: 400 });
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
      { status: 500 }
    );
  }
}
