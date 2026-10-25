import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ensureSpaceRoot } from '@/app/api/_lib/spaces';
import { readBilibiliCredentials } from '@/lib/bilibili/credentials.mjs';
import { fetchNav } from '@/lib/bilibili/auth.mjs';
import {
  fetchFavoriteFolders,
  fetchFavoriteItems,
  fetchHistory,
  fetchLikes,
  fetchRelationStat,
  fetchUserVideos,
} from '@/lib/bilibili/endpoints.mjs';
import { withCache } from '@/lib/bilibili/cache.mjs';

export const runtime = 'nodejs';

const PROVIDER = 'BILIBILI';
const TABS = new Set(['profile', 'history', 'likes', 'favorites', 'videos']);

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const url = new URL(request.url);
    const tab = TABS.has(url.searchParams.get('tab') || '') ? url.searchParams.get('tab')! : 'history';
    const page = Math.max(1, Math.min(20, Number(url.searchParams.get('page') || 1)));
    const mediaId = url.searchParams.get('mediaId') || '';
    const refresh = url.searchParams.get('refresh') === '1';

    const connector = await prisma.spaceConnector.findFirst({
      where: { spaceId, provider: PROVIDER, space: { userId } },
    });
    if (!connector) return NextResponse.json({ error: '请先连接 B 站账号' }, { status: 404 });
    if (!connector.enabled) return NextResponse.json({ error: 'B 站连接已停用' }, { status: 409 });

    const credentials = readBilibiliCredentials(connector);
    const cookie = credentials.cookie;
    const root = await ensureSpaceRoot(userId, spaceId);
    const mid = String((connector.publicConfig as any)?.mid || credentials.dedeUserId || '');

    if (tab === 'profile') {
      const result = await withCache(root, 'profile', 30 * 60 * 1000, refresh, async () => {
        const [profile, relation] = await Promise.all([
          fetchNav(cookie),
          mid ? fetchRelationStat(cookie, mid).catch(() => ({ follower: 0, following: 0 })) : Promise.resolve({ follower: 0, following: 0 }),
        ]);
        return { ...profile, ...relation };
      });
      return NextResponse.json({ tab, profile: result.data, fetchedAt: result.fetchedAt, cached: result.cached });
    }

    if (tab === 'history') {
      const result = await withCache(root, `history:${page}`, 5 * 60 * 1000, refresh, () => fetchHistory(cookie));
      return NextResponse.json({ tab, items: result.data.items, hasMore: Boolean(result.data.cursor?.has_more), fetchedAt: result.fetchedAt, cached: result.cached });
    }

    if (tab === 'likes') {
      if (!mid) return NextResponse.json({ error: '连接信息缺少用户 ID，请重新连接' }, { status: 409 });
      const result = await withCache(root, 'likes', 5 * 60 * 1000, refresh, () => fetchLikes(cookie, mid));
      return NextResponse.json({ tab, items: result.data.items, hasMore: result.data.hasMore, fetchedAt: result.fetchedAt, cached: result.cached });
    }

    if (tab === 'favorites') {
      if (!mid) return NextResponse.json({ error: '连接信息缺少用户 ID，请重新连接' }, { status: 409 });
      if (mediaId) {
        const result = await withCache(root, `favorites:${mediaId}:${page}`, 5 * 60 * 1000, refresh, () => fetchFavoriteItems(cookie, mediaId, { page }));
        return NextResponse.json({ tab, mediaId, items: result.data.items, hasMore: result.data.hasMore, fetchedAt: result.fetchedAt, cached: result.cached });
      }
      const result = await withCache(root, 'favorites:folders', 10 * 60 * 1000, refresh, () => fetchFavoriteFolders(cookie, mid));
      return NextResponse.json({ tab, folders: result.data, items: [], fetchedAt: result.fetchedAt, cached: result.cached });
    }

    if (!mid) return NextResponse.json({ error: '连接信息缺少用户 ID，请重新连接' }, { status: 409 });
    const result = await withCache(root, `videos:${page}`, 5 * 60 * 1000, refresh, () => fetchUserVideos(cookie, mid, { page }));
    return NextResponse.json({ tab, items: result.data.items, hasMore: result.data.hasMore, fetchedAt: result.fetchedAt, cached: result.cached });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error?.code === -101 || error?.code === -111) {
      const { spaceId } = await params;
      await prisma.spaceConnector.updateMany({
        where: { spaceId, provider: PROVIDER },
        data: { status: 'EXPIRED', lastError: '登录已失效，请重新扫码', lastCheckedAt: new Date() },
      }).catch(() => null);
      return NextResponse.json({ error: 'B 站登录已失效，请重新扫码' }, { status: 409 });
    }
    if (error?.code === 53013) {
      return NextResponse.json({ error: 'B 站没有公开点赞列表，请检查 B 站隐私设置' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message || '读取 B 站数据失败' }, { status: 500 });
  }
}
