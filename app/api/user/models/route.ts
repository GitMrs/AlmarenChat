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

    if (!apiBaseUrl || !apiKey) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!apiBaseUrl && user?.apiBaseUrl) apiBaseUrl = user.apiBaseUrl.trim();
      if (!apiKey && user?.apiKey) apiKey = user.apiKey.trim();
      if (!apiKey && process.env.apiKey) apiKey = process.env.apiKey.trim();
    }

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
      { status: 500 }
    );
  }
}
