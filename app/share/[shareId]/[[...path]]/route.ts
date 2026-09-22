import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { resolveSpacePath, spaceRoot } from '@/app/api/_lib/spaces';
import { renderSharedMarkdownPage } from '@/lib/markdown-share.mjs';
import { isValidShareId, resolveSharedResource } from '@/lib/space-share-policy.mjs';
import { STATIC_HTML_SANDBOX } from '@/lib/static-html-sandbox.mjs';
import { TRUSTED_STATIC_CDN_SOURCES } from '@/lib/space-preview-policy.mjs';

const MAX_SHARED_FILE_BYTES = 5 * 1024 * 1024;

function sharePolicy(request: Request, shareId: string, externalDependencies: boolean) {
  const root = `${new URL(request.url).origin}/share/${shareId}/`;
  const cdnSources = externalDependencies ? ` ${TRUSTED_STATIC_CDN_SOURCES.join(' ')}` : '';
  return [
    `sandbox ${STATIC_HTML_SANDBOX}`,
    "default-src 'none'",
    `script-src 'unsafe-inline' ${root}${cdnSources}`,
    `style-src 'unsafe-inline' ${root}${cdnSources}`,
    `img-src ${root} data: blob:`,
    `font-src ${root} data:${cdnSources}`,
    `media-src ${root}`,
    `connect-src ${root}`,
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "worker-src 'none'",
    `form-action ${root}`,
    "base-uri 'none'",
  ].join('; ');
}

function markdownSharePolicy(request: Request, shareId: string) {
  const root = `${new URL(request.url).origin}/share/${shareId}/`;
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `img-src ${root} https: data:`,
    "script-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; ');
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ shareId: string; path?: string[] }> }
) {
  try {
    const { shareId, path: pathParts = [] } = await params;
    if (!isValidShareId(shareId)) {
      return NextResponse.json({ error: 'Shared page not found' }, { status: 404 });
    }

    const entry = await prisma.spaceFile.findFirst({
      where: { shareId, shareEnabled: true, status: 'READY' },
      include: { space: { select: { userId: true } } },
    });
    if (!entry) return NextResponse.json({ error: 'Shared page not found' }, { status: 404 });

    const resource = resolveSharedResource(entry.relativePath, pathParts);
    if (!resource) {
      return NextResponse.json({ error: 'Shared resource not found' }, { status: 404 });
    }
    const { relativePath, mimeType } = resource;
    if (pathParts.length > 0) {
      const asset = await prisma.spaceFile.findFirst({
        where: { spaceId: entry.spaceId, relativePath, status: 'READY' },
        select: { id: true },
      });
      if (!asset) return NextResponse.json({ error: 'Shared resource not found' }, { status: 404 });
    }

    const root = spaceRoot(entry.space.userId, entry.spaceId);
    const target = resolveSpacePath(entry.space.userId, entry.spaceId, relativePath);
    const [actualRoot, actualTarget] = await Promise.all([realpath(root), realpath(target)]);
    if (actualTarget !== actualRoot && !actualTarget.startsWith(actualRoot + path.sep)) {
      return NextResponse.json({ error: 'Invalid shared path' }, { status: 400 });
    }
    const info = await stat(actualTarget);
    if (!info.isFile()) return NextResponse.json({ error: 'Shared resource not found' }, { status: 404 });
    if (info.size > MAX_SHARED_FILE_BYTES) {
      return NextResponse.json({ error: '共享资源不能超过 5MB' }, { status: 413 });
    }
    const bytes = await readFile(actualTarget);
    const markdown = /\.(?:md|markdown)$/i.test(relativePath);
    const body = markdown ? renderSharedMarkdownPage(bytes.toString('utf8'), entry.fileName) : bytes;
    return new Response(body, {
      headers: {
        'Content-Type': markdown ? 'text/html; charset=utf-8' : mimeType,
        'Content-Length': String(Buffer.byteLength(body)),
        'Cache-Control': 'no-store',
        'Content-Security-Policy': markdown
          ? markdownSharePolicy(request, shareId)
          : sharePolicy(request, shareId, entry.externalDependencies),
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    });
  } catch (error: any) {
    if (error.code === 'ENOENT') return NextResponse.json({ error: 'Shared resource not found' }, { status: 404 });
    return NextResponse.json({ error: 'Shared page unavailable' }, { status: 500 });
  }
}
