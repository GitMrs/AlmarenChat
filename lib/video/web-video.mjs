/**
 * 视频内容解析：从视频页 URL 提取标题/简介/字幕文本。
 * 本期支持 bilibili（wbi/v2 + player/v2 双接口字幕 API，可用 BILIBILI_SESSDATA 提供登录态）
 * 与 YouTube（播放器内嵌 captionTracks）。字幕不可用时返回空文本，由调用方回退。
 */

import { createHash } from 'node:crypto';
import { smartFetch } from '../network/proxy.ts';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 15_000;

/**
 * 默认请求走 smartFetch（直连优先，失败自动切代理）：
 * bilibili 国内直连；YouTube 等海外域名直连失败时自动走本地代理。
 */
function defaultFetch(url, init = {}) {
  const { signal: _ignoredSignal, ...rest } = init || {};
  return smartFetch(String(url), { ...rest, timeoutMs: FETCH_TIMEOUT_MS });
}

// bilibili WBI 签名的固定置换表（网页端公开算法）
const WBI_MIXIN_KEY_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19,
  29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

/**
 * 识别视频 URL。返回 { platform, id } 或 null。
 * 调用方应放在重定向解析之后，这样 b23.tv / youtu.be 短链也能命中。
 */
export function parseVideoUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(?:www|m)\./, '');

  if (host === 'bilibili.com' || host === 'b23.tv') {
    const match = url.pathname.match(/\/(BV[0-9A-Za-z]{10})/);
    return match ? { platform: 'bilibili', id: match[1] } : null;
  }

  if (host === 'youtube.com') {
    if (url.pathname === '/watch') {
      const vid = url.searchParams.get('v');
      if (vid) return { platform: 'youtube', id: vid };
    }
    const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/);
    return match ? { platform: 'youtube', id: match[1] } : null;
  }
  if (host === 'youtu.be') {
    const match = url.pathname.match(/^\/([\w-]{6,})/);
    return match ? { platform: 'youtube', id: match[1] } : null;
  }

  return null;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

async function fetchJson(url, fetchImpl, headers) {
  const response = await fetchImpl(url, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return response.json();
}

/** 兼容两种配置：只给 SESSDATA 值，或直接粘贴整段 Cookie 头 */
export function buildBilibiliHeaders() {
  const raw = String(process.env.BILIBILI_SESSDATA || '').trim().replace(/^["']|["']$/g, '');
  const headers = { 'User-Agent': BROWSER_UA, Referer: 'https://www.bilibili.com' };
  if (raw) headers.Cookie = raw.includes('=') ? raw : `SESSDATA=${raw}`;
  return headers;
}

/** bilibili：view 接口拿元数据 + cid，player 接口拿字幕列表，再拉字幕 JSON。
 * 注意：B站字幕接口需要登录态，需在环境变量配置 BILIBILI_SESSDATA（可只给 SESSDATA 值，也可粘贴整段 Cookie）。
 * 未配置时接口返回空字幕列表，视频只保留元数据（标题/简介），走见闻兜底。 */
export async function fetchBilibiliVideoText(bvid, { fetchImpl = defaultFetch } = {}) {
  const headers = buildBilibiliHeaders();
  const view = await fetchJson(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
    fetchImpl,
    headers
  );
  if (!view || view.code !== 0 || !view.data) return null;

  const data = view.data;
  const info = {
    platform: 'bilibili',
    title: String(data.title || '').trim(),
    uploader: String(data.owner?.name || '').trim(),
    desc: String(data.desc || '').trim(),
    duration: Number(data.duration) || 0,
    cid: Number(data.pages?.[0]?.cid) || 0, // ASR 需要 cid 才能拉音频流
    subtitleText: '',
  };

  const cid = data.pages?.[0]?.cid;
  if (!cid) return info;

  const subtitles = await fetchSubtitleTracks(bvid, cid, fetchImpl, headers);
  if (subtitles.length === 0) return info;

  // 按优先级逐个尝试：ai-zh > zh* > 其他中文 > 其他 AI > 其他。
  // B站 AI 字幕存在串缓存的脏数据（字幕属于别的视频），覆盖度校验失败的轨要换下一个。
  const tracks = [...subtitles]
    .sort((a, b) => scoreSubtitleTrack(b) - scoreSubtitleTrack(a))
    .slice(0, 3);
  for (const track of tracks) {
    let subtitleUrl = String(track?.subtitle_url || '');
    if (subtitleUrl.startsWith('//')) subtitleUrl = `https:${subtitleUrl}`;
    if (!subtitleUrl) continue;

    const subtitleJson = await fetchJson(subtitleUrl, fetchImpl, headers).catch(() => null);
    const body = Array.isArray(subtitleJson?.body) ? subtitleJson.body : [];
    const text = body
      .map((seg) => String(seg?.content || '').trim())
      .filter(Boolean)
      .join('\n');
    if (!text) continue;

    // 覆盖度校验：字幕时间跨度至少要覆盖视频时长的 20%
    const ends = body.map((seg) => Number(seg?.to) || 0).filter((n) => n > 0);
    const starts = body.map((seg) => Number(seg?.from) || 0);
    if (info.duration > 0 && ends.length > 0) {
      const coverage = (Math.max(...ends) - Math.min(...starts)) / info.duration;
      if (coverage < 0.2) continue;
    }
    info.subtitleText = text;
    return info;
  }
  return info;
}

function scoreSubtitleTrack(track) {
  const lan = String(track?.lan || '').toLowerCase();
  if (lan === 'ai-zh') return 100;
  if (lan.startsWith('zh')) return 90;
  if (lan.includes('zh')) return 80;
  if (lan.startsWith('ai-')) return 50;
  return 10;
}

let cachedWbiKeys = null;

async function getWbiKeys(fetchImpl, headers) {
  if (cachedWbiKeys) return cachedWbiKeys;
  const nav = await fetchJson('https://api.bilibili.com/x/web-interface/nav', fetchImpl, headers);
  const img = nav?.data?.wbi_img;
  if (!img?.img_url || !img?.sub_url) return null;
  const extract = (url) => String(url).split('/').pop().split('.')[0];
  cachedWbiKeys = { imgKey: extract(img.img_url), subKey: extract(img.sub_url) };
  return cachedWbiKeys;
}

function signWbiParams(params, imgKey, subKey) {
  const raw = imgKey + subKey;
  const mixinKey = WBI_MIXIN_KEY_TAB.map((i) => raw[i]).join('').slice(0, 32);
  const all = { ...params, wts: Math.floor(Date.now() / 1000) };
  const query = Object.keys(all)
    .sort()
    .map((k) => `${k}=${String(all[k]).replace(/[!'()*]/g, '')}`)
    .join('&');
  const wRid = createHash('md5').update(query + mixinKey).digest('hex');
  return `${query}&w_rid=${wRid}`;
}

/** 字幕轨列表：优先 wbi/v2（与网页端一致），结果为空或没有中文轨时回退 player/v2，合并去重 */
async function fetchSubtitleTracks(bvid, cid, fetchImpl, headers) {
  let wbiSubs = [];
  try {
    const keys = await getWbiKeys(fetchImpl, headers);
    if (keys) {
      const qs = signWbiParams({ bvid, cid }, keys.imgKey, keys.subKey);
      const wbi = await fetchJson(
        `https://api.bilibili.com/x/player/wbi/v2?${qs}`,
        fetchImpl,
        headers
      );
      const subs = wbi?.data?.subtitle?.subtitles;
      if (Array.isArray(subs)) wbiSubs = subs;
    }
  } catch {
    // wbi 链路失败，回退旧接口
  }
  const best = wbiSubs.reduce((max, s) => Math.max(max, scoreSubtitleTrack(s)), 0);
  if (best >= 80) return wbiSubs;

  const player = await fetchJson(
    `https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`,
    fetchImpl,
    headers
  );
  const v2Subs = player?.data?.subtitle?.subtitles;
  if (!Array.isArray(v2Subs) || v2Subs.length === 0) return wbiSubs;

  const seen = new Set(wbiSubs.map((s) => String(s?.lan || '')));
  return [...wbiSubs, ...v2Subs.filter((s) => !seen.has(String(s?.lan || '')))];
}

/** 从 HTML 中提取 marker = { ... } 的完整 JSON 对象（按括号配对，字符串感知） */
function extractJsonObject(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const braceStart = source.indexOf('{', markerIndex + marker.length);
  if (braceStart < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  return null;
}

function decodeXmlEntities(text) {
  return String(text)
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseTimedTextXml(xml) {
  const segments = [];
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const text = decodeXmlEntities(match[1]).replace(/<[^>]+>/g, '').trim();
    if (text) segments.push(text);
  }
  return segments.join('\n');
}

/** YouTube：抓 watch 页，从 ytInitialPlayerResponse 里取元数据与字幕轨 */
export async function fetchYouTubeVideoText(videoId, { fetchImpl = defaultFetch } = {}) {
  const headers = {
    'User-Agent': BROWSER_UA,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  const response = await fetchImpl(`https://www.youtube.com/watch?v=${videoId}&hl=zh-CN`, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const html = await response.text();

  const raw = extractJsonObject(html, 'ytInitialPlayerResponse');
  if (!raw) return null;
  let playerResponse;
  try {
    playerResponse = JSON.parse(raw);
  } catch {
    return null;
  }

  const details = playerResponse.videoDetails || {};
  const info = {
    platform: 'youtube',
    title: String(details.title || '').trim(),
    uploader: String(details.author || '').trim(),
    desc: String(details.shortDescription || '').trim().slice(0, 1000),
    duration: Number(details.lengthSeconds) || 0,
    subtitleText: '',
  };

  const tracks =
    playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) return info;

  const track =
    tracks.find((t) => /^zh/i.test(String(t.languageCode || ''))) ||
    tracks.find((t) => /^en/i.test(String(t.languageCode || ''))) ||
    tracks[0];
  const baseUrl = String(track?.baseUrl || '');
  if (!baseUrl) return info;

  const subtitleResponse = await fetchImpl(baseUrl, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!subtitleResponse.ok) return info;
  info.subtitleText = parseTimedTextXml(await subtitleResponse.text());
  return info;
}

/**
 * 统一入口：识别 URL 平台并抓取字幕内容。
 * 任何一步失败都返回 null 或 subtitleText 为空，绝不抛出，由调用方决定回退。
 */
export async function fetchVideoContent(pageUrl, options = {}) {
  const target = parseVideoUrl(pageUrl);
  if (!target) return null;
  try {
    if (target.platform === 'bilibili') return await fetchBilibiliVideoText(target.id, options);
    if (target.platform === 'youtube') return await fetchYouTubeVideoText(target.id, options);
  } catch {
    return null;
  }
  return null;
}

/** 把视频信息格式化为可注入上下文的文本 */
export function formatVideoContent(info) {
  const platformName = info.platform === 'bilibili' ? 'B站' : 'YouTube';
  const blocks = [
    `# ${info.title || '视频'}`,
    `> ${platformName}视频 | UP主/频道：${info.uploader || '未知'} | 时长：${formatDuration(info.duration)}`,
  ];
  if (info.desc) blocks.push(`简介：${info.desc}`);
  blocks.push('', '【字幕正文】', info.subtitleText);
  return blocks.join('\n');
}
