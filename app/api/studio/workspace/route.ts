import { NextResponse } from 'next/server';
import path from 'node:path';
import { readdir, readFile, writeFile, rm, stat, mkdir } from 'node:fs/promises';
import { requireAuth } from '@/app/api/_lib/auth';
import { resolveStudioWorkspace } from '@/lib/coding-agents/sandbox';
import { safeJoinReal } from '@/lib/coding-agents/safe-path';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  updatedAt?: number;
  children?: FileNode[];
}

async function getDirectoryTree(dir: string, baseDir: string, maxDepth = 4, currentDepth = 0): Promise<FileNode[]> {
  if (currentDepth > maxDepth) return [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const nodes: FileNode[] = [];

    for (const entry of entries) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === '.next' ||
        entry.name === '.turbo' ||
        entry.name === '.cache' ||
        entry.name === '.DS_Store' ||
        entry.name === 'Thumbs.db'
      ) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        const children = await getDirectoryTree(fullPath, baseDir, maxDepth, currentDepth + 1);
        nodes.push({
          name: entry.name,
          path: relativePath,
          isDirectory: true,
          children,
        });
      } else {
        const stats = await stat(fullPath).catch(() => null);
        nodes.push({
          name: entry.name,
          path: relativePath,
          isDirectory: false,
          size: stats?.size || 0,
          updatedAt: stats?.mtimeMs || Date.now(),
        });
      }
    }

    // Sort: directories first, then alphabetical
    return nodes.sort((a, b) => {
      if (a.isDirectory === b.isDirectory) {
        return a.name.localeCompare(b.name);
      }
      return a.isDirectory ? -1 : 1;
    });
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId') || searchParams.get('spaceId') || 'default';
    const filePath = searchParams.get('file');

    const workspaceDir = await resolveStudioWorkspace(process.cwd(), userId, workspaceId);

    // If requesting specific file content
    if (filePath) {
      const targetFile = await safeJoinReal(workspaceDir, filePath);
      if (!targetFile) {
        return NextResponse.json({ error: '禁止越权访问工作区外文件' }, { status: 403 });
      }

      const ext = path.extname(targetFile).toLowerCase();
      const imageMimes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.ico': 'image/x-icon',
        '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml',
      };

      if (imageMimes[ext]) {
        const buffer = await readFile(targetFile);
        const dataUrl = `data:${imageMimes[ext]};base64,${buffer.toString('base64')}`;
        const content = ext === '.svg' ? buffer.toString('utf-8') : '';
        return NextResponse.json({
          path: filePath,
          content,
          isImage: true,
          dataUrl,
          mimeType: imageMimes[ext],
          size: buffer.length,
        });
      }

      const content = await readFile(targetFile, 'utf-8');
      return NextResponse.json({ path: filePath, content });
    }

    // Otherwise return tree
    const tree = await getDirectoryTree(workspaceDir, workspaceDir);
    return NextResponse.json({ workspaceDir, tree });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const status = errorMsg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: errorMsg }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json();
    const workspaceId = body.workspaceId || body.spaceId || 'default';
    const { file, content = '' } = body;

    if (!file) {
      return NextResponse.json({ error: '文件名不能为空' }, { status: 400 });
    }

    const workspaceDir = await resolveStudioWorkspace(process.cwd(), userId, workspaceId);
    const targetFile = await safeJoinReal(workspaceDir, file);

    if (!targetFile) {
      return NextResponse.json({ error: '禁止越权写入工作区外文件' }, { status: 403 });
    }

    await mkdir(path.dirname(targetFile), { recursive: true });
    await writeFile(targetFile, content, 'utf-8');
    return NextResponse.json({ success: true, path: file });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const status = errorMsg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: errorMsg }, { status });
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = requireAuth(request);
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId') || searchParams.get('spaceId') || 'default';
    const filePath = searchParams.get('file');

    if (!filePath) {
      return NextResponse.json({ error: '文件名不能为空' }, { status: 400 });
    }

    const workspaceDir = await resolveStudioWorkspace(process.cwd(), userId, workspaceId);
    const targetFile = await safeJoinReal(workspaceDir, filePath);

    if (!targetFile) {
      return NextResponse.json({ error: '禁止越权删除工作区外文件' }, { status: 403 });
    }

    await rm(targetFile, { recursive: true, force: true });
    return NextResponse.json({ success: true, path: filePath });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const status = errorMsg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: errorMsg }, { status });
  }
}
