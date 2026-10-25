import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { readBilibiliCredentials } from '@/lib/bilibili/credentials.mjs';
import { parseDuration } from '@/lib/bilibili/endpoints.mjs';
import { searchBilibiliVideos } from '@/lib/video/bilibili-search.ts';

export const runtime = 'nodejs';

const PROVIDER = 'BILIBILI';

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const url = new URL(request.url);
    const query = (url.searchParams.get('q') || '').trim().slice(0, 60);
    if (!query) return NextResponse.json({ error: '请输入搜索关键词' }, { status: 400 });

    const space = await prisma.space.findFirst({ where: { id: spaceId, userId }, select: { id: true } });
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    const connector = await prisma.spaceConnector.findFirst({
      where: { spaceId, provider: PROVIDER, space: { userId } },
      select: { id: true, credentialCiphertext: true, spaceId: true, enabled: true },
    });

    let sessdata = '';
    if (connector?.enabled) {
      try {
        sessdata = readBilibiliCredentials(connector).sessdata;
      } catch {
        sessdata = '';
      }
    }

    // 浏览场景不做研习的时长过滤：短视频、长合集都要能被搜到。
    const results = await searchBilibiliVideos(query, {
      limit: 24,
      sessdata,
      maxDurationSeconds: 0,
      minDurationSeconds: 0,
    });

    const items = results.map((item) => ({
      bvid: item.bvid,
      title: item.title,
      cover: item.pic || '',
      author: item.author,
      mid: item.mid ? String(item.mid) : '',
      duration: parseDuration(item.duration),
      play: Number(item.play || 0),
      pubdate: Number(item.pubdate || 0),
      url: item.url,
      desc: item.description,
    }));

    return NextResponse.json({ query, items });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message || '搜索失败' }, { status: 500 });
  }
}
