import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { ensureSpaceRoot, resolveSpacePath } from '@/app/api/_lib/spaces';
import { verifySpacePreviewToken } from '@/lib/space-preview-token.mjs';
import { spacePreviewPolicy } from '@/lib/space-preview-policy.mjs';
import { workspaceAttemptFile } from '@/lib/workspace-staging.mjs';

const MAX_PREVIEW_FILE_BYTES = 5 * 1024 * 1024;
const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string; path: string[] }> }
) {
  try {
    const { token, path: pathParts } = await params;
    const scope = verifySpacePreviewToken(token);
    if (!scope) return NextResponse.json({ error: 'Preview expired' }, { status: 401 });
    if (!Array.isArray(pathParts) || pathParts.length === 0 || pathParts.some((part) => !part || part === '.' || part === '..')) {
      return NextResponse.json({ error: 'Invalid preview path' }, { status: 400 });
    }

    const relativePath = pathParts.join('/');
    const resolved = scope.root === 'staging'
      ? workspaceAttemptFile({
          projectRoot: process.cwd(),
          userId: scope.userId,
          spaceId: scope.spaceId,
          taskId: scope.taskId,
          attempt: scope.attempt,
        }, relativePath)
      : { root: await ensureSpaceRoot(scope.userId, scope.spaceId), target: resolveSpacePath(scope.userId, scope.spaceId, relativePath) };
    const [actualRoot, actualTarget] = await Promise.all([realpath(resolved.root), realpath(resolved.target)]);
    if (actualTarget !== actualRoot && !actualTarget.startsWith(actualRoot + path.sep)) {
      return NextResponse.json({ error: 'Invalid preview path' }, { status: 400 });
    }
    const info = await stat(actualTarget);
    if (!info.isFile()) return NextResponse.json({ error: 'Preview file not found' }, { status: 404 });
    if (info.size > MAX_PREVIEW_FILE_BYTES) {
      return NextResponse.json({ error: '预览文件不能超过 5MB' }, { status: 413 });
    }

    const extension = path.extname(actualTarget).toLowerCase();
    const mimeType = MIME_TYPES[extension];
    if (!mimeType) return NextResponse.json({ error: '当前文件类型不支持网页预览' }, { status: 415 });
    const bytes = await readFile(actualTarget);
    return new Response(bytes, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': spacePreviewPolicy({
          origin: new URL(request.url).origin,
          token,
          externalImages: scope.externalImages,
          externalDependencies: scope.externalDependencies,
        }),
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    });
  } catch (error: any) {
    if (error.code === 'ENOENT') return NextResponse.json({ error: 'Preview file not found' }, { status: 404 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
