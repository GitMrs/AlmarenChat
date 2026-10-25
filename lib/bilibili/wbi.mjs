import { createHash } from 'node:crypto';

/**
 * B 站 WBI 签名。
 * 部分 web 接口要求 wts + w_rid，否则返回 -403 / 风控。
 * 参考：https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/misc/sign/wbi.md
 */

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

export function getMixinKey(imgKey, subKey) {
  const raw = `${String(imgKey || '')}${String(subKey || '')}`;
  let out = '';
  for (const index of MIXIN_KEY_ENC_TAB) out += raw[index] || '';
  return out.slice(0, 32);
}

function encodeValue(value) {
  return String(value).replace(/[!'()*]/g, '');
}

/**
 * 返回带 wts / w_rid 的参数对象（键已排序）。
 * 调用方用 URLSearchParams 拼 query 即可。
 */
export function signWbi(params, mixinKey, now = Date.now()) {
  const wts = Math.floor(now / 1000);
  const merged = { ...params, wts };
  const entries = Object.entries(merged)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key, encodeValue(value)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  const w_rid = createHash('md5').update(`${query}${mixinKey}`).digest('hex');
  return { ...Object.fromEntries(entries), w_rid };
}

export function wbiQueryString(params, mixinKey, now = Date.now()) {
  const signed = signWbi(params, mixinKey, now);
  return new URLSearchParams(signed).toString();
}
