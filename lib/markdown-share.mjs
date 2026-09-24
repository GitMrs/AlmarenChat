import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import { normalizeShareTheme } from './share-theme-policy.mjs';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeUrl(value, kind) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (kind === 'image') {
    if (/^(?:https:|data:image\/)/i.test(url)) return url;
    if (/^(?:\/|\.\.\/)/.test(url) || !/^[^:?#]+(?:[?#].*)?$/.test(url) || url.split('/').some((part) => part === '..')) return '';
    return url.replace(/^\.\//, '');
  }
  if (/^(?:#|\/|\.\/|\.\.\/)/.test(url)) return url;
  return /^(?:https?:|mailto:)/i.test(url) ? url : '';
}

function renderMarkdownNode(node) {
  if (node.type === 'root') return (node.children || []).map(renderMarkdownNode).join('');
  if (node.type === 'text') return escapeHtml(node.value);
  if (node.type !== 'element') return '';

  const tag = String(node.tagName || '').toLowerCase();
  const children = (node.children || []).map(renderMarkdownNode).join('');
  if (tag === 'a') {
    const href = safeUrl(node.properties?.href, 'link');
    return href
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${children}</a>`
      : children;
  }
  if (tag === 'img') {
    const src = safeUrl(node.properties?.src, 'image');
    if (!src) return escapeHtml(node.properties?.alt || '');
    const title = node.properties?.title ? ` title="${escapeHtml(node.properties.title)}"` : '';
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(node.properties?.alt || '')}"${title}>`;
  }
  if (tag === 'input') {
    const checked = node.properties?.checked === true ? ' checked' : '';
    return `<input type="checkbox" disabled${checked}>`;
  }
  if (tag === 'br') return '<br>';
  if (tag === 'hr') return '<hr>';

  const allowed = new Set([
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'strong', 'em', 'del',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'thead',
    'tbody', 'tr', 'th', 'td',
  ]);
  if (!allowed.has(tag)) return children;

  const attributes = [];
  if (tag === 'ol' && Number.isInteger(node.properties?.start)) {
    attributes.push(` start="${node.properties.start}"`);
  }
  if ((tag === 'th' || tag === 'td') && ['left', 'center', 'right'].includes(node.properties?.align)) {
    attributes.push(` align="${node.properties.align}"`);
  }
  const classNames = Array.isArray(node.properties?.className)
    ? node.properties.className.filter((value) => /^[a-zA-Z0-9_-]+$/.test(String(value)))
    : [];
  if (classNames.length > 0) attributes.push(` class="${classNames.join(' ')}"`);
  return `<${tag}${attributes.join('')}>${children}</${tag}>`;
}

function renderMarkdown(markdown) {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
  const tree = processor.runSync(processor.parse(markdown));
  return renderMarkdownNode(tree);
}

function parseFrontMatter(source) {
  const match = String(source || '').match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return { metadata: {}, body: String(source || '') };
  const metadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key) metadata[key] = value;
  }
  return { metadata, body: String(source || '').slice(match[0].length) };
}

function notebookEntries(body) {
  const sections = [];
  let section = null;
  let entry = null;
  for (const line of String(body || '').split(/\r?\n/)) {
    const sectionMatch = line.match(/^##\s+(.+)$/);
    const entryMatch = line.match(/^###\s+(.+)$/);
    if (sectionMatch) {
      section = { title: sectionMatch[1].trim(), lines: [], entries: [] };
      sections.push(section);
      entry = null;
    } else if (entryMatch) {
      if (!section) {
        section = { title: '精选内容', lines: [], entries: [] };
        sections.push(section);
      }
      entry = { title: entryMatch[1].trim(), lines: [], source: '', link: '' };
      section.entries.push(entry);
    } else if (entry) {
      const sourceMatch = line.match(/^(?:发布作者|来源)\s*[:：]\s*(.*)$/);
      const linkMatch = line.match(/^(?:链接|原文)\s*[:：]\s*(\S+)$/);
      if (sourceMatch) entry.source = sourceMatch[1].trim();
      else if (linkMatch) entry.link = linkMatch[1].trim();
      else entry.lines.push(line);
    } else if (section) {
      section.lines.push(line);
    }
  }
  return sections.filter((item) => item.entries.length > 0 || item.lines.some((line) => line.trim()));
}

function renderEditorialNotebookPage(body, fileName, metadata) {
  const title = metadata.title || body.match(/^#\s+(.+)$/m)?.[1]?.trim() || String(fileName || '今日观察').replace(/\.(?:md|markdown)$/i, '');
  const intro = metadata.intro || body.match(/^#\s+.+\n+([^#\n].+)$/m)?.[1]?.trim() || '';
  const sections = notebookEntries(body);
  const count = sections.reduce((total, section) => total + section.entries.length, 0);
  const date = metadata.date || '';
  const cards = sections.map((section) => `
    <section class="section">
      <div class="section-head"><h2>${escapeHtml(section.title)}</h2><span>${section.entries.length} 条记录</span></div>
      <div class="grid">${section.entries.map((entry) => `
        <article class="card">
          ${entry.source ? `<span class="tag">${escapeHtml(entry.source)}</span>` : ''}
          <h3>${escapeHtml(entry.title)}</h3>
          <div class="summary">${renderMarkdown(entry.lines.join('\n').trim() || '暂无摘要')}</div>
          <div class="meta"><span>${entry.source ? `发布作者 · ${escapeHtml(entry.source)}` : '编辑部整理'}</span>${safeUrl(entry.link, 'link') ? `<a href="${escapeHtml(safeUrl(entry.link, 'link'))}" target="_blank" rel="noopener noreferrer">查看原文 ↗</a>` : ''}</div>
        </article>`).join('')}</div>
    </section>`).join('');
  const introHtml = intro ? `<p class="lead">${escapeHtml(intro)}</p>` : '<p class="lead">今天值得花一点时间看的，是那些正在悄悄改变判断方式的信号。</p>';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
:root{--paper:#f5f0e6;--ink:#253238;--muted:#7b817b;--green:#55766b;--orange:#c87145;--line:#d8cdbd;--white:#fffdf8}*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--paper);font-family:"Segoe Print","STKaiti","KaiTi","Noto Serif SC",serif}.page{max-width:1080px;margin:0 auto;padding:28px 20px 64px}.masthead{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:end;padding:12px 4px 20px;border-bottom:2px solid var(--ink)}.eyebrow{color:var(--orange);font:700 13px system-ui,sans-serif;letter-spacing:2px}h1{margin:7px 0 0;font-size:clamp(34px,6vw,68px);line-height:.98;letter-spacing:1px}.date{color:var(--muted);font:13px/1.6 system-ui,sans-serif;text-align:right}.intro{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(220px,.8fr);gap:24px;margin:26px 0 34px;align-items:start}.lead{font-size:20px;line-height:1.8;margin:0}.note{background:#ead99b;padding:17px 18px;transform:rotate(1.2deg);box-shadow:3px 4px 0 rgba(37,50,56,.12);font-size:15px;line-height:1.65}.note strong{display:block;color:#6e5720;margin-bottom:5px}.section{margin-top:34px}.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px}h2{margin:0;font-size:25px}.section-head span{color:var(--muted);font:12px system-ui,sans-serif}.section-head h2:before{content:"✦ ";color:var(--orange);font-size:18px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.card{position:relative;min-height:190px;padding:20px 20px 17px;background:var(--white);border:1.5px solid var(--line);border-radius:3px 8px 5px 6px;box-shadow:3px 3px 0 rgba(37,50,56,.08);animation:rise .45s ease both}.card:nth-child(2n){transform:rotate(-.45deg)}.card:nth-child(3n){transform:rotate(.35deg)}.tag{display:inline-block;padding:3px 8px;color:var(--green);border-bottom:2px solid #a5b8ac;font:800 11px system-ui,sans-serif}.card h3{margin:12px 0 8px;font-size:20px;line-height:1.35}.summary{margin:0;color:#4d5a59;font-size:15px;line-height:1.75}.summary p{margin:.35em 0}.meta{display:flex;justify-content:space-between;gap:12px;margin-top:17px;color:var(--muted);font:11px system-ui,sans-serif}.meta span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta a{flex-shrink:0;color:var(--green);white-space:nowrap;text-decoration-thickness:1px;text-underline-offset:3px}.quote{margin:34px 0;padding:22px 26px;border-left:4px solid var(--orange);color:#4e5a57;font-size:19px;line-height:1.8}footer{display:flex;justify-content:space-between;gap:16px;margin-top:42px;padding-top:16px;border-top:1px dashed var(--line);color:var(--muted);font:11px system-ui,sans-serif}@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1}}@media(max-width:680px){.page{padding:18px 15px 44px}.masthead,.intro{grid-template-columns:1fr}.date{text-align:left}.lead{font-size:17px}.grid{grid-template-columns:1fr;gap:14px}.card:nth-child(n){transform:none}footer{display:block;line-height:1.8}}
</style></head><body><main class="page"><header class="masthead"><div><div class="eyebrow">EDITORIAL NOTEBOOK</div><h1>${escapeHtml(title)}</h1></div><div class="date">${escapeHtml(date)}</div></header><section class="intro">${introHtml}<aside class="note"><strong>编辑手记</strong>内容按主题整理，保留原始出处，方便回到现场核对。</aside></section>${cards}<blockquote class="quote">一份好的简报，不是把世界缩小，而是让下一步判断变得更清楚。</blockquote><footer><span>编辑部手账 · 自动整理</span><span>共 ${count} 条 · 来源以原文为准</span></footer></main></body></html>`;
}

export function renderSharedMarkdownPage(markdown, fileName = '共享文档', options = {}) {
  const parsed = parseFrontMatter(String(markdown || ''));
  const source = parsed.body;
  if (parsed.metadata.layout === 'editorial-notebook') return renderEditorialNotebookPage(source, fileName, parsed.metadata);
  const heading = source.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title = heading || String(fileName || '共享文档').replace(/\.(?:md|markdown)$/i, '');
  const article = renderMarkdown(source);
  const theme = normalizeShareTheme(options.theme);
  const themeCss = theme === 'editorial-handwritten' ? `
    body { background: #f5f0e6; color: #253238; font-family: "Segoe Print", "STKaiti", "KaiTi", "Noto Serif SC", serif; }
    main { width: min(100% - 32px, 920px); padding-top: 28px; }
    article { background: #fffdf8; border: 1.5px solid #d8cdbd; border-radius: 3px 8px 5px 6px; box-shadow: 4px 4px 0 rgba(37, 50, 56, .08); }
    h1 { padding-bottom: .45em; border-bottom: 2px solid #253238; font-size: clamp(2.25rem, 8vw, 4.5rem); letter-spacing: 1px; }
    h2 { border-bottom: 0; color: #253238; }
    h2::before { content: "✦ "; color: #c87145; font-size: .75em; }
    h3 { display: inline; background: #ead99b; box-decoration-break: clone; -webkit-box-decoration-break: clone; padding: .08em .28em; }
    p, li { color: #4d5a59; }
    a { color: #55766b; text-decoration-thickness: 1px; text-underline-offset: 3px; }
    blockquote { border-left-color: #c87145; color: #4e5a57; font-size: 1.08rem; }
    hr { border-top: 1px dashed #d8cdbd; }
    th { background: #e8eee9; }
    @media (max-width: 640px) { body { background: #fffdf8; } article { box-shadow: none; } }
  ` : '';

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
    ${themeCss}
  </style>
</head>
<body data-share-theme="${escapeHtml(theme)}"><main><article>${article}</article></main></body>
</html>`;
}
