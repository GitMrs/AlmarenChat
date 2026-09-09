import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import { getWechatPublishingTheme } from '../wechat-publishing-themes.mjs';
import { splitWechatArticleMarkdown } from '../wechat-publishing.mjs';
import { resolveWechatArticleImage } from './wechat-article-policy.mjs';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character);
}

function styleAttribute(style) {
  const css = Object.entries(style)
    .map(([name, value]) => `${name.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)}:${value}`)
    .join(';');
  return ` style="${escapeHtml(css)}"`;
}

function safeLink(value) {
  const href = String(value || '').trim();
  return /^(?:https?:|mailto:)/i.test(href) ? href : '';
}

export function renderWechatArticleSnapshot(markdown, files, themeId) {
  const article = splitWechatArticleMarkdown(markdown);
  if (!article.title || !article.body) throw new Error('公众号文章必须包含一级标题和正文');
  const theme = getWechatPublishingTheme(themeId);
  const embedded = new Map();
  const styles = {
    h1: { margin: '0 0 24px', color: '#1f2937', fontSize: '24px', lineHeight: 1.4, fontWeight: 700, textAlign: 'center' },
    h2: { margin: '32px 0 16px', borderLeft: `4px solid ${theme.accent}`, paddingLeft: '12px', color: '#1f2937', fontSize: '20px', lineHeight: 1.5, fontWeight: 700 },
    h3: { margin: '24px 0 12px', color: '#1f2937', fontSize: '17px', lineHeight: 1.6, fontWeight: 700 },
    p: { margin: '0 0 16px', color: '#374151', fontSize: '16px', lineHeight: 1.85, textAlign: 'justify' },
    strong: { color: '#1f2937', fontWeight: 700 }, em: { color: '#4b5563' },
    ul: { margin: '0 0 18px', paddingLeft: '24px', listStyleType: 'disc' },
    ol: { margin: '0 0 18px', paddingLeft: '24px', listStyleType: 'decimal' },
    li: { margin: '0 0 8px', color: '#374151', fontSize: '16px', lineHeight: 1.75 },
    blockquote: { margin: '20px 0', borderLeft: `4px solid ${theme.quoteBorder}`, backgroundColor: theme.quoteBackground, padding: '14px 16px', color: '#4b5563' },
    a: { color: theme.link, textDecoration: 'underline' },
    hr: { margin: '28px auto', width: '36px', border: '0', borderTop: `2px solid ${theme.border}` },
    img: { display: 'block', width: '100%', maxWidth: '100%', height: 'auto', margin: '20px auto' },
    pre: { margin: '18px 0', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', borderRadius: '4px', backgroundColor: '#f3f4f6', padding: '14px', color: '#374151', fontSize: '13px', lineHeight: 1.7 },
    code: { borderRadius: '3px', backgroundColor: '#f3f4f6', padding: '2px 4px', color: '#374151', fontSize: '0.9em' },
    table: { width: '100%', margin: '20px 0', borderCollapse: 'collapse', color: '#374151', fontSize: '13px', lineHeight: 1.55 },
    th: { border: `1px solid ${theme.border}`, backgroundColor: theme.accentSoft, padding: '8px', textAlign: 'left', fontWeight: 700 },
    td: { border: `1px solid ${theme.border}`, padding: '8px', verticalAlign: 'top' },
  };

  const renderNode = (node) => {
    if (node.type === 'root') return (node.children || []).map(renderNode).join('');
    if (node.type === 'text') return escapeHtml(node.value);
    if (node.type !== 'element') return '';
    const tag = String(node.tagName || '').toLowerCase();
    const children = (node.children || []).map(renderNode).join('');
    if (tag === 'img') {
      const file = resolveWechatArticleImage(String(node.properties?.src || ''), files);
      embedded.set(file.id, file);
      return `<img data-almaren-space-file="${escapeHtml(file.id)}" alt="${escapeHtml(node.properties?.alt || '')}"${styleAttribute(styles.img)}>`;
    }
    if (tag === 'a') {
      const href = safeLink(node.properties?.href);
      return href ? `<a href="${escapeHtml(href)}"${styleAttribute(styles.a)}>${children}</a>` : children;
    }
    if (tag === 'input') {
      const checked = node.properties?.checked === true ? ' checked' : '';
      return `<input type="checkbox" disabled${checked}>`;
    }
    if (tag === 'br') return '<br>';
    if (tag === 'hr') return `<hr${styleAttribute(styles.hr)}>`;
    const allowed = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'strong', 'em', 'del', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);
    if (!allowed.has(tag)) return children;
    return `<${tag}${styles[tag] ? styleAttribute(styles[tag]) : ''}>${children}</${tag}>`;
  };
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
  const tree = processor.runSync(processor.parse(article.body));
  const html = renderNode(tree);
  return { title: article.title.slice(0, 64), html, embeddedFiles: [...embedded.values()] };
}
