import { biliJson } from './client.mjs';
import { fetchNav } from './auth.mjs';
import { getMixinKey, wbiQueryString } from './wbi.mjs';

let wbiCache = { img: '', sub: '', at: 0 };
const WBI_TTL = 60 * 60 * 1000;

async function getWbiKeys(cookie) {
  if (wbiCache.img && wbiCache.sub && Date.now() - wbiCache.at < WBI_TTL) return wbiCache;
  const nav = await fetchNav(cookie);
  wbiCache = { ...nav.wbiImg, at: Date.now() };
  return wbiCache;
}

async function wbiUrl(base, params, cookie) {
  const keys = await getWbiKeys(cookie);
  const mixinKey = getMixinKey(keys.img, keys.sub);
  return `${base}?${wbiQueryString(params, mixinKey)}`;
}

export function parseDuration(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value || '').trim();
  if (!text) return 0;
  const parts = text.split(':').map((part) => parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function videoItem(input) {
  const bvid = String(input.bvid || input.history?.bvid || '');
  if (!bvid) return null;
  return {
    bvid,
    title: String(input.title || input.show_title || '').trim(),
    cover: String(input.cover || input.pic || input.covers?.[0] || ''),
    author: String(input.author_name || input.owner?.name || input.upper?.name || input.author || ''),
    mid: String(input.author_mid || input.owner?.mid || input.upper?.mid || input.mid || ''),
    duration: parseDuration(input.duration ?? input.length),
    play: Number(input.stat?.view ?? input.cnt_info?.play ?? input.play ?? 0),
    pubdate: Number(input.pubdate ?? input.pubtime ?? input.created ?? input.view_at ?? 0),
    url: `https://www.bilibili.com/video/${bvid}`,
  };
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || !item.bvid || seen.has(item.bvid)) continue;
    seen.add(item.bvid);
    out.push(item);
  }
  return out;
}

export async function fetchHistory(cookie, { max = 0 } = {}) {
  const params = new URLSearchParams({ ps: '30', view_at: '0', business: '', type: 'archive' });
  if (max) params.set('max', String(max));
  const data = await biliJson(`https://api.bilibili.com/x/web-interface/history/cursor?${params}`, { cookie });
  const list = Array.isArray(data?.list) ? data.list : [];
  return {
    items: dedupe(list.map((item) => videoItem({ ...item, ...item.history, bvid: item.history?.bvid || item.bvid }))),
    cursor: data?.cursor || null,
  };
}

export async function fetchLikes(cookie, mid) {
  // B 站点赞列表只有这一个 web 接口，没有 wbi 变体，也没有 pn/ps 分页参数。
  const data = await biliJson(
    `https://api.bilibili.com/x/space/like/video?vmid=${encodeURIComponent(mid)}`,
    { cookie }
  );
  const list = Array.isArray(data) ? data : Array.isArray(data?.list) ? data.list : [];
  return { items: dedupe(list.map(videoItem)), page: 1, hasMore: false };
}

export async function fetchFavoriteFolders(cookie, mid) {
  const data = await biliJson(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${encodeURIComponent(mid)}`, { cookie });
  const list = Array.isArray(data?.list) ? data.list : [];
  return list.map((folder) => ({
    id: String(folder.id),
    title: String(folder.title || '未命名收藏夹'),
    count: Number(folder.media_count ?? 0),
  }));
}

export async function fetchFavoriteItems(cookie, mediaId, { page = 1 } = {}) {
  const params = new URLSearchParams({ media_id: String(mediaId), pn: String(page), ps: '20', platform: 'web' });
  const data = await biliJson(`https://api.bilibili.com/x/v3/fav/resource/list?${params}`, { cookie });
  const list = Array.isArray(data?.medias) ? data.medias : [];
  return {
    items: dedupe(list.map(videoItem)),
    page,
    hasMore: Boolean(data?.has_more),
  };
}

export async function fetchUserVideos(cookie, mid, { page = 1 } = {}) {
  const url = await wbiUrl(
    'https://api.bilibili.com/x/space/wbi/arc/search',
    { mid, pn: page, ps: 30, order: 'pubdate', platform: 'web' },
    cookie
  );
  const data = await biliJson(url, { cookie });
  const list = Array.isArray(data?.list?.vlist) ? data.list.vlist : [];
  return {
    items: dedupe(list.map((item) => videoItem({ ...item, bvid: item.bvid, cover: item.pic }))),
    page,
    hasMore: list.length >= 30,
  };
}

export async function fetchRelationStat(cookie, mid) {
  const data = await biliJson(`https://api.bilibili.com/x/relation/stat?vmid=${encodeURIComponent(mid)}`, { cookie });
  return {
    follower: Number(data?.follower ?? 0),
    following: Number(data?.following ?? 0),
  };
}

export async function fetchVideoDetail(cookie, bvid) {
  const data = await biliJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, { cookie });
  return {
    bvid: String(data?.bvid || bvid),
    aid: Number(data?.aid || 0),
    title: String(data?.title || ''),
    cover: String(data?.pic || ''),
    author: String(data?.owner?.name || ''),
    mid: String(data?.owner?.mid || ''),
    duration: Number(data?.duration || 0),
    pubdate: Number(data?.pubdate || 0),
    url: `https://www.bilibili.com/video/${bvid}`,
    stat: {
      view: Number(data?.stat?.view ?? 0),
      like: Number(data?.stat?.like ?? 0),
      coin: Number(data?.stat?.coin ?? 0),
      favorite: Number(data?.stat?.favorite ?? 0),
      reply: Number(data?.stat?.reply ?? 0),
    },
    desc: String(data?.desc || ''),
  };
}

export function invalidateWbiCache() {
  wbiCache = { img: '', sub: '', at: 0 };
}
