'use client';

import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import type { SpaceMessageAttachment } from '@/types';

const USER_COLLAPSE_CHARS = 600;
const USER_COLLAPSE_LINES = 12;
const USER_PREVIEW_CHARS = 800;
const ASSISTANT_COLLAPSE_CHARS = 2000;
const ASSISTANT_COLLAPSE_LINES = 50;
const ASSISTANT_PREVIEW_CHARS = 600;
const MAX_SVG_CHARS = 100_000;
const MAX_SVG_NODES = 500;
const ALLOWED_SVG_ELEMENTS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath',
  'mask', 'pattern', 'title', 'desc',
]);
const ALLOWED_SVG_ATTRIBUTES = new Set([
  'xmlns', 'viewbox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx',
  'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'fill-opacity', 'fill-rule', 'stroke',
  'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'stroke-dashoffset', 'opacity', 'transform', 'text-anchor', 'dominant-baseline',
  'font-family', 'font-size', 'font-style', 'font-weight', 'letter-spacing', 'dx', 'dy',
  'rotate', 'textlength', 'lengthadjust', 'offset', 'stop-color', 'stop-opacity',
  'gradientunits', 'gradienttransform', 'spreadmethod', 'patternunits', 'patterntransform',
  'clippathunits', 'maskunits', 'maskcontentunits', 'preserveaspectratio', 'id', 'role',
  'aria-label',
]);

type ContentSegment = { type: 'markdown' | 'svg'; content: string };

function splitSvgContent(content: string) {
  const segments: ContentSegment[] = [];
  const pattern = /<svg\b[\s\S]*?<\/svg\s*>/gi;
  let cursor = 0;
  let svgCount = 0;
  for (const match of content.matchAll(pattern)) {
    if (match.index === undefined || svgCount >= 3) break;
    if (match.index > cursor) segments.push({ type: 'markdown', content: content.slice(cursor, match.index) });
    segments.push({ type: 'svg', content: match[0] });
    cursor = match.index + match[0].length;
    svgCount += 1;
  }
  if (cursor < content.length) segments.push({ type: 'markdown', content: content.slice(cursor) });
  return segments.length > 0 ? segments : [{ type: 'markdown' as const, content }];
}

function sanitizeSvg(source: string) {
  if (source.length > MAX_SVG_CHARS || /<!DOCTYPE|<!ENTITY/i.test(source)) return null;
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = document.documentElement;
  if (root.localName.toLowerCase() !== 'svg' || document.querySelector('parsererror')) return null;
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  if (elements.length > MAX_SVG_NODES) return null;

  for (const element of elements) {
    if (!ALLOWED_SVG_ELEMENTS.has(element.localName.toLowerCase())) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const unsafeUrl = /(?:javascript|vbscript|data):/i.test(value)
        || (/url\s*\(/i.test(value) && !/^url\(\s*#[A-Za-z_][\w:.-]*\s*\)$/i.test(value));
      const invalidId = name === 'id' && !/^[A-Za-z_][\w:.-]*$/.test(value);
      if (!ALLOWED_SVG_ATTRIBUTES.has(name) || unsafeUrl || invalidId || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return {
    markup: new XMLSerializer().serializeToString(root),
    title: root.querySelector('title')?.textContent?.trim().slice(0, 120) || 'SVG 图像',
  };
}

function SafeSvgPreview({ source }: { source: string }) {
  const [preview, setPreview] = useState<{ url: string; title: string } | null>();

  useEffect(() => {
    const sanitized = sanitizeSvg(source);
    if (!sanitized) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([sanitized.markup], { type: 'image/svg+xml' }));
    setPreview({ url, title: sanitized.title });
    return () => URL.revokeObjectURL(url);
  }, [source]);

  if (preview === undefined) return <div className="h-24 w-full animate-pulse rounded-lg bg-slate-100" />;
  if (!preview) {
    return (
      <pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
        <code>{source}</code>
      </pre>
    );
  }
  return (
    <img
      src={preview.url}
      alt={preview.title}
      className="max-h-[520px] w-auto max-w-full rounded-lg border border-black/[0.08] bg-white object-contain"
    />
  );
}

function AssistantMarkdown({ content }: { content: string }) {
  const segments = useMemo(() => splitSvgContent(content), [content]);
  return segments.map((segment, index) => segment.type === 'svg' ? (
    <SafeSvgPreview key={`svg-${index}`} source={segment.content} />
  ) : segment.content ? (
    <ReactMarkdown key={`markdown-${index}`} remarkPlugins={[remarkGfm]}>{segment.content}</ReactMarkdown>
  ) : null);
}

function MessageAttachments({ attachments }: { attachments?: SpaceMessageAttachment[] }) {
  const images = attachments?.filter((attachment) => attachment.type === 'image') || [];
  if (images.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {images.map((attachment) => (
        <a
          key={attachment.url}
          href={attachment.url}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-2xl border border-white/25 bg-white/15"
          onClick={(event) => event.stopPropagation()}
        >
          <img src={attachment.url} alt={attachment.name || '上传图片'} className="max-h-56 max-w-[240px] object-cover" />
        </a>
      ))}
    </div>
  );
}

function UserMessage({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = content.length > USER_COLLAPSE_CHARS || content.split('\n').length > USER_COLLAPSE_LINES;
  const displayContent =
    shouldCollapse && !expanded && content.length > USER_PREVIEW_CHARS
      ? `${content.slice(0, USER_PREVIEW_CHARS)}\n...`
      : content;

  if (!shouldCollapse) return <p className="whitespace-pre-wrap text-sm leading-7">{content}</p>;

  return (
    <div className="space-y-3">
      <div className="relative">
        <p className={cn('whitespace-pre-wrap text-sm leading-7 transition-[max-height]', !expanded && 'max-h-56 overflow-hidden')}>
          {displayContent}
        </p>
        {!expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 rounded-b-[18px] bg-gradient-to-t from-black/12 via-black/4 to-transparent" />
        )}
      </div>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="inline-flex items-center text-xs font-black text-white/90 underline decoration-white/35 underline-offset-4 transition hover:text-white hover:decoration-white"
      >
        {expanded ? '收起消息' : '展开完整消息'}
      </button>
    </div>
  );
}

function AssistantMessage({ content, shouldAutoCollapse }: { content: string; shouldAutoCollapse: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const containsSvg = /<svg\b[\s\S]*?<\/svg\s*>/i.test(content);
  const shouldCollapse =
    shouldAutoCollapse &&
    !containsSvg &&
    (content.length > ASSISTANT_COLLAPSE_CHARS || content.split('\n').length > ASSISTANT_COLLAPSE_LINES);
  const displayContent =
    shouldCollapse && !expanded && content.length > ASSISTANT_PREVIEW_CHARS
      ? `${content.slice(0, ASSISTANT_PREVIEW_CHARS)}\n\n...`
      : content;

  return (
    <div className="space-y-3">
      <div className="markdown-body min-w-0 max-w-full overflow-hidden text-sm leading-7">
        <AssistantMarkdown content={displayContent} />
      </div>
      {shouldCollapse && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex items-center text-xs font-black text-slate-500 underline decoration-slate-300 underline-offset-4 transition hover:text-slate-900 hover:decoration-slate-500"
        >
          {expanded ? '收起回答' : '展开完整回答'}
        </button>
      )}
    </div>
  );
}

export default function MessageContent({
  role,
  content,
  attachments,
  shouldAutoCollapse = false,
}: {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: SpaceMessageAttachment[];
  shouldAutoCollapse?: boolean;
}) {
  return (
    <>
      <MessageAttachments attachments={attachments} />
      {role === 'assistant' ? (
        <AssistantMessage content={content} shouldAutoCollapse={shouldAutoCollapse} />
      ) : content ? (
        <UserMessage content={content} />
      ) : null}
    </>
  );
}
