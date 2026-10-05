import { NextResponse } from 'next/server';
import {
  getAvailableSources,
  getSourcesByCategory,
  getTrendingSnapshot,
  getAvailableDates,
  TRENDING_CATEGORIES,
} from '@/lib/trending';
import type { TrendingCategory } from '@/lib/trending/types';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceParam = searchParams.get('source');
    const categoryParam = searchParams.get('category') as TrendingCategory | 'all' | null;
    const dateParam = searchParams.get('date') || 'today';
    const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '20', 10)), 50);
    const forceRefresh = searchParams.get('refresh') === 'true' || searchParams.get('refresh') === '1';

    const availableDates = await getAvailableDates();

    // 1. 获取所有支持的数据源列表、分类列表与可用日期列表
    if (sourceParam === 'sources') {
      return NextResponse.json({
        success: true,
        categories: TRENDING_CATEGORIES,
        sources: getAvailableSources(),
        dates: availableDates,
      });
    }

    // 2. 批量拉取数据源（支持全量，或按 category 分类拉取）
    if (sourceParam === 'all' || (!sourceParam && categoryParam)) {
      const targetSources = categoryParam
        ? getSourcesByCategory(categoryParam)
        : getAvailableSources();

      const results = await Promise.all(
        targetSources.map(async (src) => {
          try {
            const snapshot = await getTrendingSnapshot(src.id, {
              forceRefresh,
              date: dateParam,
            });
            return {
              ...snapshot,
              category: src.category,
              categoryName: src.categoryName,
              icon: src.icon,
              items: snapshot.items.slice(0, limit),
            };
          } catch {
            return {
              source: src.id,
              sourceName: src.name,
              category: src.category,
              categoryName: src.categoryName,
              icon: src.icon,
              updatedAt: new Date().toISOString(),
              total: 0,
              items: [],
            };
          }
        })
      );

      return NextResponse.json({
        success: true,
        queryDate: dateParam,
        availableDates,
        data: results,
      });
    }

    // 3. 拉取单个指定数据源
    const targetSourceId = sourceParam || 'zhihu';
    const snapshot = await getTrendingSnapshot(targetSourceId, {
      forceRefresh,
      date: dateParam,
    });

    const singleResult = {
      source: snapshot.source,
      sourceName: snapshot.sourceName,
      category: snapshot.category,
      categoryName: snapshot.categoryName,
      icon: snapshot.icon,
      updatedAt: snapshot.updatedAt,
      total: snapshot.total,
      items: snapshot.items.slice(0, limit),
    };

    return NextResponse.json({
      success: true,
      queryDate: dateParam,
      availableDates,
      ...singleResult,
      data: [singleResult],
    });
  } catch (error: any) {
    console.error('[api/trending] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to fetch trending topics',
      },
      { status: 500 }
    );
  }
}
