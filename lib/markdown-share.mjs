import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderSharedMarkdownPage(markdown, fileName = '共享文档') {
  const source = String(markdown || '');
  const heading = source.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title = heading || String(fileName || '共享文档').replace(/\.(?:md|markdown)$/i, '');
  const article = renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm],
    skipHtml: true,
    components: {
      a: ({ children, ...props }) => React.createElement('a', {
        ...props,
        target: '_blank',
        rel: 'noopener noreferrer',
      }, children),
    },
  }, source));

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f7f8fa; color: #172033; }
    main { width: min(100% - 32px, 760px); margin: 0 auto; padding: 32px 0 64px; }
    article { padding: 32px clamp(20px, 5vw, 48px); background: #fff; border: 1px solid #e7eaf0; border-radius: 8px; box-shadow: 0 8px 28px rgba(23, 32, 51, .06); }
    h1, h2, h3 { margin: 1.5em 0 .65em; line-height: 1.35; color: #0f172a; }
    h1 { margin-top: 0; font-size: 2rem; }
    h2 { padding-bottom: .4em; border-bottom: 1px solid #e7eaf0; font-size: 1.45rem; }
    h3 { font-size: 1.15rem; }
    p, li { font-size: 1rem; line-height: 1.85; }
    ul, ol { padding-left: 1.5rem; }
    a { color: #0866c6; overflow-wrap: anywhere; }
    blockquote { margin: 1.25rem 0; padding: .1rem 1rem; border-left: 3px solid #94a3b8; color: #526074; }
    pre { overflow-x: auto; padding: 16px; border-radius: 6px; background: #111827; color: #e5e7eb; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    :not(pre) > code { padding: .15em .35em; border-radius: 4px; background: #eef1f5; }
    table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
    th, td { padding: 8px 12px; border: 1px solid #dfe3e8; text-align: left; }
    img { max-width: 100%; height: auto; }
    hr { margin: 2rem 0; border: 0; border-top: 1px solid #e7eaf0; }
    @media (max-width: 640px) { main { width: 100%; padding: 0; } article { min-height: 100vh; padding: 24px 18px 48px; border: 0; border-radius: 0; box-shadow: none; } h1 { font-size: 1.65rem; } }
  </style>
</head>
<body><main><article>${article}</article></main></body>
</html>`;
}
