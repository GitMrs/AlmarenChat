'use client';

import { forwardRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getWechatPublishingTheme } from '@/lib/wechat-publishing-themes.mjs';

function publishingComponents(theme: ReturnType<typeof getWechatPublishingTheme>): Components {
  return {
  h1: ({ children }) => <h1 style={{ margin: '0 0 24px', color: '#1f2937', fontSize: '24px', lineHeight: 1.4, fontWeight: 700, textAlign: 'center' }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ margin: '32px 0 16px', borderLeft: `4px solid ${theme.accent}`, paddingLeft: '12px', color: '#1f2937', fontSize: '20px', lineHeight: 1.5, fontWeight: 700 }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ margin: '24px 0 12px', color: '#1f2937', fontSize: '17px', lineHeight: 1.6, fontWeight: 700 }}>{children}</h3>,
  p: ({ children }) => <p style={{ margin: '0 0 16px', color: '#374151', fontSize: '16px', lineHeight: 1.85, textAlign: 'justify' }}>{children}</p>,
  strong: ({ children }) => <strong style={{ color: '#1f2937', fontWeight: 700 }}>{children}</strong>,
  em: ({ children }) => <em style={{ color: '#4b5563' }}>{children}</em>,
  ul: ({ children }) => <ul style={{ margin: '0 0 18px', paddingLeft: '24px', listStyleType: 'disc' }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0 0 18px', paddingLeft: '24px', listStyleType: 'decimal' }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: '0 0 8px', color: '#374151', fontSize: '16px', lineHeight: 1.75 }}>{children}</li>,
  blockquote: ({ children }) => <blockquote style={{ margin: '20px 0', borderLeft: `4px solid ${theme.quoteBorder}`, backgroundColor: theme.quoteBackground, padding: '14px 16px', color: '#4b5563' }}>{children}</blockquote>,
  a: ({ children, href }) => <a href={href} style={{ color: theme.link, textDecoration: 'underline' }}>{children}</a>,
  hr: () => <hr style={{ margin: '28px auto', width: '36px', border: '0', borderTop: `2px solid ${theme.border}` }} />,
  img: ({ src, alt }) => <img src={src || ''} alt={alt || ''} style={{ display: 'block', width: '100%', maxWidth: '100%', height: 'auto', margin: '20px auto' }} />,
  pre: ({ children }) => <pre style={{ margin: '18px 0', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', borderRadius: '4px', backgroundColor: '#f3f4f6', padding: '14px', color: '#374151', fontSize: '13px', lineHeight: 1.7 }}>{children}</pre>,
  code: ({ children }) => <code style={{ borderRadius: '3px', backgroundColor: '#f3f4f6', padding: '2px 4px', color: '#374151', fontSize: '0.9em' }}>{children}</code>,
  table: ({ children }) => <table style={{ width: '100%', margin: '20px 0', borderCollapse: 'collapse', color: '#374151', fontSize: '13px', lineHeight: 1.55 }}>{children}</table>,
  th: ({ children }) => <th style={{ border: `1px solid ${theme.border}`, backgroundColor: theme.accentSoft, padding: '8px', textAlign: 'left', fontWeight: 700 }}>{children}</th>,
  td: ({ children }) => <td style={{ border: `1px solid ${theme.border}`, padding: '8px', verticalAlign: 'top' }}>{children}</td>,
  };
}

const MarkdownPublishingPreview = forwardRef<HTMLDivElement, { content: string; themeId?: string }>(({ content, themeId }, ref) => (
  <div
    ref={ref}
    style={{ margin: '0 auto', maxWidth: '680px', overflowWrap: 'anywhere', color: '#374151', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}
  >
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={publishingComponents(getWechatPublishingTheme(themeId))}>{content}</ReactMarkdown>
  </div>
));

MarkdownPublishingPreview.displayName = 'MarkdownPublishingPreview';

export default MarkdownPublishingPreview;
