import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { fetchVideoContent, formatVideoContent, parseVideoUrl } from './video/web-video.mjs';
import { readAsrCache } from './video/video-asr.mjs';

const MAX_CONTENT_CHARS = 20_000;
const MIN_SUBTITLE_CHARS = 100;
const MAX_REDIRECTS = 3;
const BLOCKED_HOST = /^(?:localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:|\[?fe80:)/i;
const DEFAULT_BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

function rejectUrl(target) {
  if (target.protocol !== 'https:') return '只允许访问 HTTPS 地址';
  if (BLOCKED_HOST.test(target.hostname) || /\.(?:internal|local)$/i.test(target.hostname)) {
    return `禁止访问内部地址：${target.hostname}`;
  }
  return null;
}

/**
 * 将 Readability 清洗后的干净 HTML 片段转换为保留标题层级、代码块与列表结构的文本，
 * 避免纯 textContent 把 <h2>/<h3>/<pre>/<li> 全部粘连成无结构长串。
 */
function htmlFragmentToStructuredText(htmlFragment, fallbackText = '') {
  if (!htmlFragment || typeof htmlFragment !== 'string') return fallbackText;
  try {
    const { document } = parseHTML(`<!DOCTYPE html><html><body>${htmlFragment}</body></html>`);
    for (const pre of document.querySelectorAll('pre')) {
      const codeText = (pre.textContent || '').replace(/^\n+|\n+$/g, '');
      pre.replaceWith(`\n\n\`\`\`\n${codeText}\n\`\`\`\n\n`);
    }
    for (const h of document.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      const level = Math.min(6, Math.max(2, Number(h.tagName?.slice(1)) || 2));
      const text = (h.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) {
        h.replaceWith(`\n\n${'#'.repeat(level)} ${text}\n\n`);
      }
    }
    for (const li of document.querySelectorAll('li')) {
      const text = (li.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) {
        li.replaceWith(`\n- ${text}`);
      }
    }
    for (const block of document.querySelectorAll('p, div, section, blockquote, tr, br')) {
      if (block.tagName?.toLowerCase() === 'br') {
        block.replaceWith('\n');
      } else {
        block.after('\n\n');
      }
    }
    const structured = (document.body?.textContent || '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return structured.length >= Math.min(40, fallbackText.trim().length) ? structured : fallbackText;
  } catch {
    return fallbackText;
  }
}

function safeParseArticle(html, pageUrl) {
  let title;
  let content = '';
  try {
    const { document } = parseHTML(html);
    const reader = new Readability(document, { charThreshold: 100 });
    const article = reader.parse();
    if (article) {
      title = article.title?.trim() || undefined;
      content = htmlFragmentToStructuredText(article.content, article.textContent || '');
    }
  } catch {
    content = '';
  }

  if (!content.trim()) {
    try {
      const { document } = parseHTML(html);
      const main =
        document.querySelector('main') ||
        document.querySelector('article') ||
        document.getElementById('js_content') ||
        document.querySelector('.article-content') ||
        document.querySelector('.markdown-body') ||
        document.querySelector('.Post-RichTextContainer') ||
        document.querySelector('.post-content') ||
        document.querySelector('#content');
      if (main) {
        const text = htmlFragmentToStructuredText(main.innerHTML, main.textContent || '')
          .replace(/\s+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        if (text.length > 100) content = text;
      }
      if (!title) {
        const titleEl = document.querySelector('title');
        if (titleEl?.textContent) title = titleEl.textContent.trim();
      }
    } catch {
      content = '';
    }
  }

  return {
    title: title ? title.replace(/\s+/g, ' ').trim() : undefined,
    content: content.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
  };
}

function formatResponseBody(body, maxChars = MAX_CONTENT_CHARS) {
  const limit = maxChars > 0 && Number.isFinite(maxChars) ? maxChars : Infinity;
  const trimmed = body.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed);
      const formatted = JSON.stringify(parsed, null, 2);
      if (formatted.length <= limit) return { content: formatted, truncated: false };
    } catch {}
  }
  if (body.length <= limit) {
    return { content: body, truncated: false };
  }
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        let kept = parsed;
        while (kept.length > 5 && JSON.stringify(kept).length > limit) {
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
            while (kept.length > 5 && JSON.stringify(copy).length > limit) {
              kept = kept.slice(0, Math.floor(kept.length * 0.7));
              copy[key] = kept;
            }
          }
        }
        const jsonStr = JSON.stringify(copy, null, 2);
        if (jsonStr.length <= limit) {
          return {
            content: jsonStr + `\n\n// [JSON 数据列表已智能保留核心有效项，原始数据量过大已自动精简结构]`,
            truncated: true,
          };
        }
      }
    } catch {}
  }
  return {
    content: `${body.slice(0, limit)}\n\n[正文已截断，原文 ${body.length} 字符]`,
    truncated: true,
  };
}

export async function fetchWebPage(
  value,
  { fetchImpl, signal = undefined, videoAsrCacheReader = undefined, maxChars = MAX_CONTENT_CHARS } = {}
) {
  const limit = maxChars > 0 && Number.isFinite(maxChars) ? maxChars : Infinity;
  let target;
  try {
    target = new URL(String(value || '').trim());
  } catch {
    throw new Error('网址格式无效');
  }
  const initialError = rejectUrl(target);
  if (initialError) throw new Error(initialError);
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('当前运行时不支持网页读取');

  try {
    let response;
    let redirects = 0;
    for (;;) {
      response = await doFetch(target, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: DEFAULT_BROWSER_HEADERS,
      });
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

    // 视频页优先走字幕解析（bilibili / YouTube）；字幕不可用时回退普通正文提取。
    // 识别放在重定向解析之后，b23.tv / youtu.be 短链也能命中。
    // 未注入 fetchImpl 时让视频模块用自己的 smartFetch 通道（直连优先，失败自动切代理）。
    const videoTarget = parseVideoUrl(target.href);
    if (videoTarget) {
      const video = await fetchVideoContent(
        target.href,
        fetchImpl ? { fetchImpl } : {}
      ).catch(() => null);
      if (video) {
        // 字幕缺失时先查 ASR 缓存：之前后台转写过的视频（bilibili 或 youtube）直接命中，秒回全文
        if (!video.subtitleText || video.subtitleText.trim().length < MIN_SUBTITLE_CHARS) {
          const cacheKey = videoTarget.platform === 'bilibili' ? videoTarget.id : `yt-${videoTarget.id}`;
          const cacheReader = videoAsrCacheReader ?? readAsrCache;
          const cached = await cacheReader(cacheKey).catch(() => null);
          if (cached?.text) video.subtitleText = cached.text;
        }
        if (video.subtitleText && video.subtitleText.trim().length >= MIN_SUBTITLE_CHARS) {
          let content = formatVideoContent(video);
          let truncated = false;
          if (content.length > limit) {
            content = `${content.slice(0, limit)}\n\n[字幕已截断，原文约 ${content.length} 字符]`;
            truncated = true;
          }
          return {
            url: target.href,
            title: video.title || undefined,
            content,
            truncated,
            totalChars: content.length,
          };
        }
        // 无字幕/无缓存：只返回干净的元数据（标题/UP主/简介），不解释原因、不触发转写。
        // 绝不回退 Readability——视频页提取出的"正文"是推荐流垃圾。
        const metaLines = [
          `# ${video.title || '视频'}`,
          `> ${video.platform === 'bilibili' ? 'B站' : 'YouTube'}视频 | UP主/频道：${video.uploader || '未知'} | 时长：${Math.floor((video.duration || 0) / 60)}:${String((video.duration || 0) % 60).padStart(2, '0')}`,
        ];
        if (video.desc) metaLines.push(`简介：${video.desc}`);
        const meta = metaLines.join('\n');
        return {
          url: target.href,
          title: video.title || undefined,
          content: meta,
          truncated: false,
          totalChars: meta.length,
        };
      }
    }

    const body = await response.text();
    const contentType = (response.headers?.get?.('content-type') || response.headers?.get?.('Content-Type') || '').toLowerCase();
    const trimmedBody = body.trim();
    const isHtml = contentType.includes('text/html') ||
      contentType.includes('application/xhtml') ||
      (!contentType.includes('application/json') && (trimmedBody.startsWith('<!DOCTYPE') || trimmedBody.startsWith('<html') || (trimmedBody.startsWith('<') && trimmedBody.endsWith('>'))));

    if (isHtml) {
      const article = safeParseArticle(body, target.href);
      if (article.content) {
        let contentWithTitle = article.title ? `# ${article.title}\n\n${article.content}` : article.content;
        let truncated = false;
        if (contentWithTitle.length > limit) {
          contentWithTitle = `${contentWithTitle.slice(0, limit)}\n\n[正文已截断，原文约 ${contentWithTitle.length} 字符]`;
          truncated = true;
        }
        return {
          url: target.href,
          title: article.title,
          content: contentWithTitle,
          truncated,
          totalChars: body.length,
        };
      }
    }

    const formatted = formatResponseBody(body, limit);
    return {
      url: target.href,
      content: formatted.content,
      truncated: formatted.truncated,
      totalChars: body.length,
    };
  } catch (error) {
    throw error;
  }
}
