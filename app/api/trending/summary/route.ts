import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { getUserIdFromRequest } from '@/app/api/_lib/auth';
import { getOrGenerateTrendingSummary } from '@/lib/trending';
import type { TrendingCategory } from '@/lib/trending/types';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date') || 'today';
    const categoryParam = (searchParams.get('category') as TrendingCategory | 'all') || 'all';
    const forceRefresh = searchParams.get('refresh') === 'true' || searchParams.get('refresh') === '1';

    // 尝试获取登录用户的自定义大模型配置
    let apiBaseUrl: string | null = null;
    let apiKey: string | null = null;
    let modelName: string | null = null;

    const userId = getUserIdFromRequest(request);
    if (userId) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { apiBaseUrl: true, apiKey: true, modelName: true },
        });
        if (user) {
          apiBaseUrl = user.apiBaseUrl;
          apiKey = user.apiKey;
          modelName = user.modelName;
        }
      } catch {
        // 容错降级
      }
    }

    const result = await getOrGenerateTrendingSummary({
      date: dateParam,
      category: categoryParam,
      forceRefresh,
      apiBaseUrl,
      apiKey,
      modelName,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('[api/trending/summary] GET Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to generate summary' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const dateParam = body.date || 'today';
    const categoryParam = (body.category as TrendingCategory | 'all') || 'all';
    const forceRefresh = body.forceRefresh === true;

    let apiBaseUrl: string | null = null;
    let apiKey: string | null = null;
    let modelName: string | null = null;

    const userId = getUserIdFromRequest(request);
    if (userId) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { apiBaseUrl: true, apiKey: true, modelName: true },
        });
        if (user) {
          apiBaseUrl = user.apiBaseUrl;
          apiKey = user.apiKey;
          modelName = user.modelName;
        }
      } catch {
        // 容错降级
      }
    }

    const result = await getOrGenerateTrendingSummary({
      date: dateParam,
      category: categoryParam,
      forceRefresh,
      apiBaseUrl,
      apiKey,
      modelName,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('[api/trending/summary] POST Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to generate summary' },
      { status: 500 }
    );
  }
}
