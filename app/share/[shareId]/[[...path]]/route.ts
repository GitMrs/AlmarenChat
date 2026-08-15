import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { resolveSpacePath, spaceRoot } from '@/app/api/_lib/spaces';
import { isValidShareId, resolveSharedResource } from '@/lib/space-share-policy.mjs';

const MAX_SHARED_FILE_BYTES = 5 * 1024 * 1024;

function sharePolicy(request: Request, shareId: string) {
  const root = `${new URL(request.url).origin}/share/${shareId}/`;
  return [
    'sandbox allow-scripts',
    "default-src 'none'",
    `script-src 'unsafe-inline' ${root}`,
    `style-src 'unsafe-inline' ${root}`,
    `img-src ${root} data: blob:`,
    `font-src ${root} data:`,
    `media-src ${root}`,
    `connect-src ${root}`,
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "worker-src 'none'",
    "form-action 'none'",
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
    return new Response(bytes, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'no-store',
        'Content-Security-Policy': sharePolicy(request, shareId),
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
