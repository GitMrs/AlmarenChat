import { smartFetch } from '../web/proxy.ts';

export interface BilibiliVideoSearchResult {
  bvid: string;
  title: string;
  author: string;
  mid?: number;
  play?: number;
  duration?: string;
  description: string;
  pic?: string;
  pubdate?: number;
  url: string;
}

export type BilibiliSearchSort =
  | 'totalrank'   // 综合排序
  | 'click'       // 最多播放
  | 'pubdate'     // 最新发布
  | 'stow'        // 最多收藏
  | 'dm'          // 最多弹幕
  | 'scores';     // 最多评论

export interface SearchBilibiliVideosOptions {
  limit?: number;
  page?: number;
  sort?: BilibiliSearchSort;
  timeoutMs?: number;
  /** 完整的 B 站 Cookie 头；用于空间连接器登录态。 */
  cookie?: string;
  sessdata?: string;
  /** 最大视频时长（秒）。超过该长度的视频直接过滤（例如合集/几百小时教程） */
  maxDurationSeconds?: number;
  /** 最小视频时长（秒）。低于该长度的视频直接过滤（例如几秒短视频） */
  minDurationSeconds?: number;
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function stripHtmlTags(str: string): string {
  return String(str || '').replace(/<[^>]+>/g, '').trim();
}

/**
 * 学习视频时长约束（参考 bilibili_learning_bot 设计）：
 * - 硬下限：剔除 < 2 分钟的无实质信息量短切片
 * - 硬上限：剔除 > 60 分钟（3600秒）的大合集/超长大部头，避免转写与上下文爆炸
 * - 黄金区间：6 分钟 ~ 60 分钟的精讲与深度课程享有加权
 */
export const DEFAULT_MAX_STUDY_VIDEO_DURATION_SECONDS = 60 * 60; // 60分钟
export const DEFAULT_MIN_STUDY_VIDEO_DURATION_SECONDS = 2 * 60;  // 2分钟

export function parseBilibiliDurationSeconds(durationStr?: string): number {
  if (!durationStr) return 0;
  const parts = String(durationStr).trim().split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => isNaN(n))) return 0;

  if (parts.length === 2) {
    // mm:ss
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    // hh:mm:ss
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

/**
 * 在 B 站主动检索指定关键词的视频
 */
export async function searchBilibiliVideos(
  keyword: string,
  options: SearchBilibiliVideosOptions = {}
): Promise<BilibiliVideoSearchResult[]> {
  const query = (keyword || '').trim();
  if (!query) return [];

  const limit = Math.max(1, Math.min(options.limit || 10, 50));
  const page = Math.max(1, options.page || 1);
  const sort = options.sort || 'totalrank';
  const timeoutMs = options.timeoutMs || 15_000;
  const maxDurationSeconds = options.maxDurationSeconds ?? DEFAULT_MAX_STUDY_VIDEO_DURATION_SECONDS;
  const minDurationSeconds = options.minDurationSeconds ?? DEFAULT_MIN_STUDY_VIDEO_DURATION_SECONDS;

  const url = new URL('https://api.bilibili.com/x/web-interface/search/type');
  url.searchParams.set('search_type', 'video');
  url.searchParams.set('keyword', query);
  url.searchParams.set('order', sort);
  url.searchParams.set('page', String(page));

  const headers: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    Referer: 'https://www.bilibili.com/',
  };

  const cookie = String(options.cookie || '').trim();
  if (cookie) {
    headers.Cookie = cookie;
  } else {
    const sessdata = options.sessdata || process.env.BILIBILI_SESSDATA;
    if (sessdata) headers.Cookie = `SESSDATA=${sessdata}`;
  }

  try {
    const res = await smartFetch(url.toString(), {
      method: 'GET',
      headers,
      timeoutMs,
    });

    if (!res.ok) {
      return [];
    }

    const json = (await res.json()) as any;
    if (json.code !== 0 || !json.data?.result) {
      return [];
    }

    const list = Array.isArray(json.data.result) ? json.data.result : [];
    const results: BilibiliVideoSearchResult[] = [];

    for (const item of list) {
      if (!item.bvid) continue;

      // 时长过滤（参考 bilibili_learning_bot）：
      // 坚决剔除 > 60分钟的合集/大课（2小时、4小时等），以及 < 2分钟的极短切片
      const durationSec = parseBilibiliDurationSeconds(item.duration);
      if (maxDurationSeconds && durationSec > maxDurationSeconds) {
        continue;
      }
      if (minDurationSeconds && durationSec < minDurationSeconds) {
        continue;
      }

      results.push({
        bvid: item.bvid,
        title: stripHtmlTags(item.title || ''),
        author: stripHtmlTags(item.author || item.uname || ''),
        mid: item.mid || item.author_mid || undefined,
        play: typeof item.play === 'number' ? item.play : undefined,
        duration: item.duration || undefined,
        description: stripHtmlTags(item.description || item.desc || '').slice(0, 300),
        pic: item.pic?.startsWith('//') ? `https:${item.pic}` : item.pic || undefined,
        pubdate: item.pubdate,
        url: `https://www.bilibili.com/video/${item.bvid}`,
      });
      if (results.length >= limit) break;
    }

    return results;
  } catch {
    return [];
  }
}
