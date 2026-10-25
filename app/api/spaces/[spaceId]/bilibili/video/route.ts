import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { readBilibiliCredentials } from '@/lib/bilibili/credentials.mjs';
import { fetchVideoDetail } from '@/lib/bilibili/endpoints.mjs';
import { fetchVideoContent, formatVideoContent } from '@/lib/video/web-video.mjs';
import { isVideoAsrEnabled } from '@/lib/video/video-asr.mjs';

export const runtime = 'nodejs';

const PROVIDER = 'BILIBILI';

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const url = new URL(request.url);
    const bvid = (url.searchParams.get('bvid') || '').trim();
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) {
      return NextResponse.json({ error: '视频 ID 无效' }, { status: 400 });
    }

    const space = await prisma.space.findFirst({ where: { id: spaceId, userId }, select: { id: true } });
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    const connector = await prisma.spaceConnector.findFirst({
      where: { spaceId, provider: PROVIDER, space: { userId } },
      select: { id: true, credentialCiphertext: true, spaceId: true, enabled: true },
    });

    let cookie = '';
    if (connector?.enabled) {
      try {
        cookie = readBilibiliCredentials(connector).cookie;
      } catch {
        cookie = '';
      }
    }

    const pageUrl = `https://www.bilibili.com/video/${bvid}`;
    // 复用仓库已有的视频解析链路（其章节锁定、字幕降级等思路吸收自 bilibili_learning_bot），
    // 这里只把登录态换成当前空间连接器，避免再写一套字幕抓取。
    const [detail, content] = await Promise.all([
      fetchVideoDetail(cookie, bvid).catch(() => null),
      fetchVideoContent(pageUrl, cookie ? { cookie } : {}).catch(() => null),
    ]);

    if (!detail && !content) {
      return NextResponse.json({ error: '拿不到这条视频的信息' }, { status: 404 });
    }

    const video = {
      bvid,
      title: content?.title || detail?.title || bvid,
      cover: detail?.cover || '',
      author: content?.uploader || detail?.author || '',
      mid: detail?.mid || '',
      duration: content?.duration || detail?.duration || 0,
      pubdate: detail?.pubdate || 0,
      play: detail?.stat?.view || 0,
      url: pageUrl,
      desc: content?.desc || detail?.desc || '',
      cid: content?.cid || 0,
      subtitleText: content?.subtitleText || '',
      hasSubtitle: Boolean(content?.subtitleText),
      stat: detail?.stat || null,
    };

    const formatted = formatVideoContent({
      platform: 'bilibili',
      title: video.title,
      uploader: video.author,
      duration: video.duration,
      desc: video.desc,
      subtitleText: video.subtitleText,
    });

    return NextResponse.json({
      video,
      formatted,
      asrEnabled: isVideoAsrEnabled(),
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message || '解析视频失败' }, { status: 500 });
  }
}
