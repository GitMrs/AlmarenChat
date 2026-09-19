const MAX_CONTENT_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const BLOCKED_HOST = /^(?:localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:|\[?fe80:)/i;

function rejectUrl(target) {
  if (target.protocol !== 'https:') return '只允许访问 HTTPS 地址';
  if (BLOCKED_HOST.test(target.hostname) || /\.(?:internal|local)$/i.test(target.hostname)) {
    return `禁止访问内部地址：${target.hostname}`;
  }
  return null;
}

function formatResponseBody(body) {
  if (body.length <= MAX_CONTENT_CHARS) {
    return { content: body, truncated: false };
  }
  const trimmed = body.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        let kept = parsed;
        while (kept.length > 5 && JSON.stringify(kept).length > MAX_CONTENT_CHARS) {
          kept = kept.slice(0, Math.floor(kept.length * 0.7));
        }
        return {
          content: JSON.stringify(kept, null, 2) + `\n\n// [JSON 列表已智能保留前 ${kept.length} 项有效数据，原始共 ${parsed.length} 项]`,
          truncated: true,
        };
      }
      if (parsed && typeof parsed === 'object') {
        const copy = { ...parsed };
        for (const [key, val] of Object.entries(copy)) {
          if (Array.isArray(val) && val.length > 5) {
            let kept = val;
            while (kept.length > 5 && JSON.stringify(copy).length > MAX_CONTENT_CHARS) {
              kept = kept.slice(0, Math.floor(kept.length * 0.7));
              copy[key] = kept;
            }
          }
        }
        const jsonStr = JSON.stringify(copy, null, 2);
        if (jsonStr.length <= MAX_CONTENT_CHARS) {
          return {
            content: jsonStr + `\n\n// [JSON 数据列表已智能保留核心有效项，原始数据量过大已自动精简结构]`,
            truncated: true,
          };
        }
      }
    } catch {}
  }
  return {
    content: `${body.slice(0, MAX_CONTENT_CHARS)}\n\n[正文已截断，原文 ${body.length} 字符]`,
    truncated: true,
  };
}

export async function fetchWebPage(value, { fetchImpl = globalThis.fetch, signal } = {}) {
  let target;
  try {
    target = new URL(String(value || '').trim());
  } catch {
    throw new Error('网址格式无效');
  }
  const initialError = rejectUrl(target);
  if (initialError) throw new Error(initialError);
  if (typeof fetchImpl !== 'function') throw new Error('当前运行时不支持网页读取');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    let response;
    let redirects = 0;
    for (;;) {
      response = await fetchImpl(target, { method: 'GET', redirect: 'manual', signal: controller.signal });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      if (!location) break;
      if (++redirects > MAX_REDIRECTS) throw new Error(`重定向次数超过 ${MAX_REDIRECTS} 次`);
      const next = new URL(location, target);
      const nextError = rejectUrl(next);
      if (nextError) throw new Error(`拒绝重定向到 ${next.href}：${nextError}`);
      target = next;
    }
    if (!response.ok) throw new Error(`网页请求失败：HTTP ${response.status}`);
    const body = await response.text();
    const formatted = formatResponseBody(body);
    return {
      url: target.href,
      content: formatted.content,
      truncated: formatted.truncated,
      totalChars: body.length,
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('网页读取超时（10 秒）');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
