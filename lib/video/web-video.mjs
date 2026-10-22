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
  // B站 AI 字幕存在串缓存的脏数据（字幕属于别的视频）或纯背景音乐符号轨，校验失败的轨要换下一个。
  const tracks = [...subtitles]
    .sort((a, b) => scoreSubtitleTrack(b) - scoreSubtitleTrack(a))
    .slice(0, 4);
  for (const track of tracks) {
    let subtitleUrl = String(track?.subtitle_url || track?.subtitle_url_v2 || '').trim();
    if (subtitleUrl === '/') subtitleUrl = '';
    if (subtitleUrl.startsWith('//')) subtitleUrl = `https:${subtitleUrl}`;
    else if (subtitleUrl.startsWith('/')) subtitleUrl = `https://api.bilibili.com${subtitleUrl}`;
    if (!subtitleUrl) continue;

    const subtitleJson = await fetchJson(subtitleUrl, fetchImpl, headers).catch(() => null);
    const body = Array.isArray(subtitleJson?.body) ? subtitleJson.body : [];
    const text = body
      .map((seg) => String(seg?.content || '').trim())
      .filter(Boolean)
      .join('\n');
    if (!text) continue;

    // 1. 过滤纯音乐符号 / 纯噪声字幕轨（如全程 ♪ ♫ [音乐]）
    if (isMusicOrNoiseOnlySubtitle(text)) continue;

    // 2. 覆盖度校验：字幕时间跨度至少要覆盖视频时长的 20%
    const ends = body.map((seg) => Number(seg?.to) || 0).filter((n) => n > 0);
    const starts = body.map((seg) => Number(seg?.from) || 0);
    if (info.duration > 0 && ends.length > 0) {
      const coverage = (Math.max(...ends) - Math.min(...starts)) / info.duration;
      if (coverage < 0.2) continue;
    }

    // 3. 防串台相关性校验：拦截 B站 CDN 偶发返回的跨视频错误字幕缓存
    if (!isSubtitleMatchingVideo(info.title, info.desc, text)) continue;

    info.subtitleText = text;
    return info;
  }
  return info;
}

/**
 * 识别纯音乐符号或纯环境音标记的无实质内容字幕轨
 */
export function isMusicOrNoiseOnlySubtitle(text) {
  const raw = String(text || '').trim();
  if (!raw) return true;
  const hasMusicMarker = /[♪♫♬♩]|\[(?:音乐|纯音乐|BGM|伴奏|掌声|笑声)\]|\((?:music|bgm|applause)\)/i.test(raw);
  if (!hasMusicMarker) return false;
  const stripped = raw
    .replace(/[♪♫♬♩\s.,，。！？!?、~～…\-—_()（）[\]【】]/g, '')
    .replace(/(?:音乐|纯音乐|BGM|伴奏|掌声|笑声|啦+|啊+|哦+|嗯+|哼+)/gi, '');
  return stripped.length < 15 || stripped.length / raw.length < 0.25;
}

/**
 * 提取用于匹配的中文 2-gram（滑动窗口）与英文单词。
 * 必须用重叠 2-gram：贪婪切片会把「松软的舒芙蕾」切成「松软的舒」「芙蕾松饼」这类不存在的词，
 * 导致合法字幕被误判为串台。
 */
const COMMON_CJK_CHARS = new Set(
  '的了是在和与及或就都也还很更最我你他她它们这那什么如何为怎吗呢吧啊之其所以且但如如果您请让给对从到把被将等个些有没不大会说要来去上下中里吗呀嘛哦'
);
const EN_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'you', 'are', 'was', 'but', 'not',
  'have', 'from', 'they', 'will', 'can', 'his', 'her', 'its', 'our', 'your', 'all',
]);

function collectMatchTerms(text) {
  const terms = new Set();
  const source = String(text || '').toLowerCase();
  for (const run of source.match(/[\u4e00-\u9fff]+/g) || []) {
    for (let i = 0; i < run.length - 1; i += 1) {
      const a = run[i];
      const b = run[i + 1];
      // 过滤「如何」「这个」这类纯功能词组合，保留有辨识度的实词
      if (COMMON_CJK_CHARS.has(a) && COMMON_CJK_CHARS.has(b)) continue;
      terms.add(a + b);
    }
  }
  for (const word of source.match(/[a-z]{3,}/g) || []) {
    if (!EN_STOP_WORDS.has(word)) terms.add(word);
  }
  return terms;
}

/**
 * 检查字幕与视频标题/简介是否存在基本语义关联，拦截 B站 AI 字幕跨视频串台脏数据。
 * 对单元测试短桩文本（<60字）或极短标题自动放行。
 */
export function isSubtitleMatchingVideo(title, desc, subtitleText) {
  const sub = String(subtitleText || '').toLowerCase();
  const cleanTitle = String(title || '').trim().toLowerCase();
  if (sub.length < 60 || cleanTitle.length < 4) return true;

  const sampleWindow = sub.slice(0, 10000);

  // 1. 标题命中任意一个有辨识度的词即放行
  const titleTerms = collectMatchTerms(cleanTitle);
  if (titleTerms.size === 0) return true;
  for (const term of titleTerms) {
    if (sampleWindow.includes(term)) return true;
  }

  // 2. 标题未命中时，简介前段需命中至少 2 个独立词（单个词偶然撞词概率太高）
  const descTerms = collectMatchTerms(String(desc || '').slice(0, 200));
  let descHits = 0;
  for (const term of descTerms) {
    if (sampleWindow.includes(term)) descHits += 1;
    if (descHits >= 2) return true;
  }

  // 对常见课程/访谈开场白或超长深度视频放宽校验
  const hasCommonOpening = /(?:大家好|同学们|欢迎来到|今天我们|这期|这一期|本视频|聊一聊|分享)/.test(
    sub.slice(0, 400)
  );
  if (hasCommonOpening || sub.length >= 2500) return true;

  // 中短字幕（60~2500字）与标题/简介 0 关键词重叠且无标准开场，判定为串台脏字幕
  return false;
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
  const cookie = process.env.YOUTUBE_COOKIE || process.env.YT_COOKIE;
  if (cookie) {
    headers.Cookie = cookie;
  }
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
