import { smartFetch } from '../web/proxy.ts';

export const BILIBILI_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export class BilibiliError extends Error {
  constructor(message, code = -1, status = 0) {
    super(message);
    this.name = 'BilibiliError';
    this.code = Number(code);
    this.status = Number(status);
  }
}

const ERROR_HINTS = {
  [-101]: 'B 站登录已失效，请重新扫码',
  [-111]: 'B 站 CSRF 校验失败，请重新扫码',
  [-352]: '触发 B 站风控，请 30 分钟后再试',
  [-799]: '请求过于频繁，请稍后再试',
  [-403]: 'B 站拒绝了这次请求，请稍后再试',
  [-404]: '内容不存在或已失效',
  [-412]: '请求被 B 站风控拦截，请稍后再试',
  53013: '该用户的点赞列表未公开',
};

export function mapBilibiliError(code, message) {
  const hint = ERROR_HINTS[code];
  return new BilibiliError(hint || String(message || 'B 站接口返回错误'), code);
}

export async function biliFetch(url, options = {}) {
  const { cookie, method = 'GET', body, headers = {}, timeoutMs = 12000 } = options;
  const response = await smartFetch(url, {
    method,
    headers: {
      'User-Agent': BILIBILI_UA,
      Referer: 'https://www.bilibili.com/',
      Origin: 'https://www.bilibili.com',
      Accept: 'application/json, text/plain, */*',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...headers,
    },
    body,
    prefer: 'direct-first',
    timeoutMs,
  });
  return response;
}

export async function biliJson(url, options = {}) {
  const response = await biliFetch(url, options);
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new BilibiliError('B 站返回了非 JSON 数据，可能触发了风控', -1, response.status);
  }
  if (payload && payload.code !== undefined && payload.code !== 0) {
    throw mapBilibiliError(payload.code, payload.message);
  }
  if (payload && payload.code === undefined && payload.data === undefined && payload.result === undefined) {
    // 少数接口直接返回业务对象
    return payload;
  }
  return payload?.data ?? payload?.result ?? payload;
}

export async function biliForm(url, form, options = {}) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) {
    if (value !== undefined && value !== null && value !== '') body.set(key, String(value));
  }
  return biliJson(url, { ...options, method: 'POST', body: body.toString() });
}
