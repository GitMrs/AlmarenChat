import { biliJson, BilibiliError } from './client.mjs';

const PASSPORT = 'https://passport.bilibili.com/x/passport-login/web/qrcode';

export const QR_STATUS = Object.freeze({
  SUCCESS: 0,
  WAITING: 86101,
  SCANNED: 86090,
  EXPIRED: 86038,
});

export function parseCookieString(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const map = {};
  for (const chunk of text.split(';')) {
    const index = chunk.indexOf('=');
    if (index <= 0) continue;
    const key = chunk.slice(0, index).trim();
    const value = chunk.slice(index + 1).trim();
    if (key) map[key] = value;
  }
  return normalizeCredentials(map);
}

function rawQueryMap(url) {
  const text = String(url || '');
  const index = text.indexOf('?');
  if (index < 0) return {};
  const map = {};
  for (const chunk of text.slice(index + 1).split('&')) {
    const eq = chunk.indexOf('=');
    if (eq <= 0) continue;
    let name = chunk.slice(0, eq);
    try {
      name = decodeURIComponent(name);
    } catch {
      // 保留原始 key
    }
    // 保留原始编码：浏览器 Cookie 里存的就是编码后的值，解码后反而可能失效。
    if (name) map[name] = chunk.slice(eq + 1);
  }
  return map;
}

/** 从扫码成功返回的 crossDomain URL + Set-Cookie 合并出凭据。
 * Set-Cookie 是浏览器真正会保存的值，优先使用；URL 作为兜底。 */
export function credentialsFromQr(url, setCookieMap = {}) {
  const map = { ...rawQueryMap(url) };
  for (const [name, value] of Object.entries(setCookieMap || {})) {
    if (value) map[name] = value;
  }
  return normalizeCredentials(map);
}

export function parseCookieUrl(url) {
  return credentialsFromQr(url);
}

function normalizeCredentials(map) {
  const sessdata = String(map.SESSDATA || map.sessdata || '').trim();
  const biliJct = String(map.bili_jct || map.biliJct || map.csrf || '').trim();
  const dedeUserId = String(map.DedeUserID || map.dedeUserId || map.mid || '').trim();
  const dedeUserIdCkMd5 = String(map['DedeUserID__ckMd5'] || map.dedeUserIdCkMd5 || '').trim();
  const buvid3 = String(map.buvid3 || '').trim();
  const buvid4 = String(map.buvid4 || '').trim();
  if (!sessdata || !biliJct) return null;
  return { sessdata, biliJct, dedeUserId, dedeUserIdCkMd5, buvid3, buvid4 };
}

export function buildCookieHeader(credentials) {
  const parts = [
    `SESSDATA=${credentials.sessdata}`,
    `bili_jct=${credentials.biliJct}`,
  ];
  if (credentials.dedeUserId) parts.push(`DedeUserID=${credentials.dedeUserId}`);
  if (credentials.dedeUserIdCkMd5) parts.push(`DedeUserID__ckMd5=${credentials.dedeUserIdCkMd5}`);
  if (credentials.buvid3) parts.push(`buvid3=${credentials.buvid3}`);
  if (credentials.buvid4) parts.push(`buvid4=${credentials.buvid4}`);
  return parts.join('; ');
}

export async function createQrCode() {
  const data = await biliJson(`${PASSPORT}/generate`, { method: 'GET' });
  const qrUrl = String(data?.url || '');
  const key = String(data?.qrcode_key || '');
  if (!qrUrl || !key) throw new BilibiliError('B 站没有返回二维码，请稍后再试');
  return { url: qrUrl, key };
}

function readSetCookieMap(response) {
  const map = {};
  const list = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') || ''];
  for (const raw of list) {
    const pair = String(raw || '').split(';')[0];
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim().replace(/^"|"$/g, '');
    if (name) map[name] = value;
  }
  return map;
}

export async function pollQrCode(key) {
  const response = await fetch(`${PASSPORT}/poll?qrcode_key=${encodeURIComponent(key)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Referer: 'https://www.bilibili.com/',
    },
    cache: 'no-store',
  }).catch(() => null);
  if (!response) throw new BilibiliError('无法连接 B 站登录服务');
  const payload = await response.json().catch(() => null);
  const data = payload?.data || {};
  const code = Number(data.code);
  if (code === QR_STATUS.SUCCESS) {
    const setCookieMap = readSetCookieMap(response);
    const credentials = credentialsFromQr(data.url, setCookieMap);
    if (!credentials) throw new BilibiliError('B 站登录成功但没有拿到有效 Cookie，请改用粘贴 Cookie');
    return { status: 'success', credentials };
  }
  if (code === QR_STATUS.SCANNED) return { status: 'scanned' };
  if (code === QR_STATUS.EXPIRED) return { status: 'expired' };
  if (code === QR_STATUS.WAITING) return { status: 'waiting' };
  throw new BilibiliError(data.message || '扫码状态异常', code);
}

export async function fetchNav(cookie) {
  const data = await biliJson('https://api.bilibili.com/x/web-interface/nav', { cookie });
  if (!data || data.isLogin !== true) {
    throw new BilibiliError('B 站登录已失效，请重新扫码', -101);
  }
  return {
    mid: String(data.mid || ''),
    uname: String(data.uname || ''),
    face: String(data.face || ''),
    level: String(data.level_info?.current_level ?? ''),
    coins: Number(data.money ?? 0),
    vip: Boolean(data.vipStatus),
    wbiImg: {
      img: extractWbiKey(data.wbi_img?.img_url),
      sub: extractWbiKey(data.wbi_img?.sub_url),
    },
  };
}

function extractWbiKey(url) {
  const name = String(url || '').split('/').pop() || '';
  return name.split('.')[0];
}
