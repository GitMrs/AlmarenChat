import { biliForm, BilibiliError } from './client.mjs';
import { fetchVideoDetail } from './endpoints.mjs';

const ALREADY_LIKED = 65006;
const ALREADY_COINED = 34005;

export async function likeVideo(credentials, bvid, like = true) {
  try {
    await biliForm(
      'https://api.bilibili.com/x/web-interface/archive/like',
      { bvid, like: like ? 1 : 0, csrf: credentials.biliJct },
      { cookie: credentials.cookie }
    );
    return { bvid, liked: like };
  } catch (error) {
    if (error?.code === ALREADY_LIKED) return { bvid, liked: like, already: true };
    throw error;
  }
}

export async function coinVideo(credentials, bvid, count = 1) {
  const multiply = Math.max(1, Math.min(2, Number(count) || 1));
  try {
    await biliForm(
      'https://api.bilibili.com/x/web-interface/coin/add',
      { bvid, multiply, select_like: 0, csrf: credentials.biliJct },
      { cookie: credentials.cookie }
    );
    return { bvid, coins: multiply };
  } catch (error) {
    if (error?.code === ALREADY_COINED) {
      throw new BilibiliError('已经给这个视频投过币了', ALREADY_COINED);
    }
    throw error;
  }
}

export async function favoriteVideo(credentials, bvid, mediaId) {
  const media = String(mediaId || '').trim();
  if (!/^\d+$/.test(media)) throw new BilibiliError('请选择要加入的收藏夹');
  const detail = await fetchVideoDetail(credentials.cookie, bvid);
  if (!detail.aid) throw new BilibiliError('拿不到视频的 aid，无法收藏');
  await biliForm(
    'https://api.bilibili.com/x/v3/fav/resource/deal',
    {
      rid: detail.aid,
      type: 2,
      add_media_ids: media,
      del_media_ids: '',
      csrf: credentials.biliJct,
      platform: 'web',
    },
    { cookie: credentials.cookie }
  );
  return { bvid, mediaId: media, favorited: true };
}

export async function runBilibiliAction(kind, credentials, payload) {
  if (kind === 'BILIBILI_LIKE') {
    return likeVideo(credentials, payload.bvid, payload.like !== false);
  }
  if (kind === 'BILIBILI_COIN') {
    return coinVideo(credentials, payload.bvid, payload.count);
  }
  if (kind === 'BILIBILI_FAVORITE') {
    return favoriteVideo(credentials, payload.bvid, payload.mediaId);
  }
  throw new BilibiliError('不支持的 B 站动作');
}
