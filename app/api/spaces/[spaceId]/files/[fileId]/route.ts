import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ensureSpaceRoot, getSpaceForUser, resolveSpacePath } from '@/app/api/_lib/spaces';
import { isEditableSpaceFile, MAX_EDITABLE_SPACE_FILE_BYTES } from '@/lib/space-files';
import { workspaceAttemptFile } from '@/lib/workspace-staging.mjs';
import { logicalWorkspaceRelativePath } from '@/lib/space-work-paths.mjs';

const EDIT_BLOCKING_RUN_STATUSES = ['QUEUED', 'PLANNING', 'RUNNING', 'SUMMARIZING', 'CANCEL_REQUESTED'];

function safeMimeType(value?: string | null) {
  const mimeType = String(value || '').trim();
  return /^[\w.+-]+\/[\w.+-]+(?:;\s*charset=[\w-]+)?$/i.test(mimeType)
    ? mimeType
    : 'application/octet-stream';
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; fileId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { spaceId, fileId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    const file = await prisma.spaceFile.findFirst({ where: { id: fileId, spaceId } });
    if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });

    const stagedTask = file.taskId && ['GENERATING', 'WAITING_APPROVAL'].includes(file.status)
      ? await prisma.agentTask.findUnique({ where: { id: file.taskId }, select: { attempt: true } })
      : null;
    const staged = stagedTask
      ? workspaceAttemptFile({ projectRoot: process.cwd(), userId, spaceId, workId: file.workId, taskId: file.taskId, attempt: stagedTask.attempt }, logicalWorkspaceRelativePath(file.workId, file.relativePath))
      : null;
    const root = staged?.root || await ensureSpaceRoot(userId, spaceId);
    const target = staged?.target || resolveSpacePath(userId, spaceId, file.relativePath);
    const spaceRoot = await ensureSpaceRoot(userId, spaceId);
    const [actualSpaceRoot, actualRoot, actualTarget] = await Promise.all([realpath(spaceRoot), realpath(root), realpath(target)]);
    if (actualRoot !== actualSpaceRoot && !actualRoot.startsWith(actualSpaceRoot + path.sep)) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }
    if (actualTarget !== actualRoot && !actualTarget.startsWith(actualRoot + path.sep)) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }
    const fileStat = await stat(actualTarget);
    if (!fileStat.isFile()) return NextResponse.json({ error: 'File not found' }, { status: 404 });

    const bytes = await readFile(actualTarget);
    if (new URL(request.url).searchParams.get('mode') === 'edit') {
      if (!isEditableSpaceFile(file.fileName)) {
        return NextResponse.json({ error: '当前文件类型不支持在线编辑' }, { status: 415 });
      }
      if (bytes.byteLength > MAX_EDITABLE_SPACE_FILE_BYTES) {
        return NextResponse.json({ error: '在线编辑仅支持 1MB 以内的文本文件' }, { status: 413 });
      }
      let content = '';
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        return NextResponse.json({ error: '文件不是有效的 UTF-8 文本' }, { status: 415 });
      }
      const activeRun = await prisma.agentRun.findFirst({
        where: { spaceId, status: { in: EDIT_BLOCKING_RUN_STATUSES } },
        select: { id: true },
      });
      const readOnlyReason = file.status === 'GENERATING'
        ? 'Agent 正在生成此文件'
        : file.status === 'WAITING_APPROVAL'
          ? '此文件正在等待步骤审核'
          : activeRun
            ? '空间任务正在执行，暂时不能修改文件'
            : file.status === 'INCOMPLETE'
              ? '未完成文件暂不支持直接修改'
              : null;
      return NextResponse.json({
        content,
        updatedAt: file.updatedAt?.toISOString() || null,
        readOnlyReason,
      });
    }
    const encodedName = encodeURIComponent(file.fileName)
      .replace(/'/g, '%27')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29');
    return new Response(bytes, {
      headers: {
        'Content-Type': safeMimeType(file.mimeType),
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodedName}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error.code === 'ENOENT') return NextResponse.json({ error: 'File not found' }, { status: 404 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; fileId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { spaceId, fileId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    const body = await request.json();
    const content = typeof body.content === 'string' ? body.content : null;
    const expectedUpdatedAt = typeof body.updatedAt === 'string' ? body.updatedAt : null;
    if (content === null) return NextResponse.json({ error: 'Missing content' }, { status: 400 });

    const file = await prisma.spaceFile.findFirst({ where: { id: fileId, spaceId } });
    if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (!isEditableSpaceFile(file.fileName)) {
      return NextResponse.json({ error: '当前文件类型不支持在线编辑' }, { status: 415 });
    }
    if (file.status !== 'READY') {
      return NextResponse.json({ error: '当前文件状态不允许修改' }, { status: 409 });
    }
    if ((file.updatedAt?.toISOString() || null) !== expectedUpdatedAt) {
      return NextResponse.json({ error: '文件已被其他操作更新，请重新打开后再修改' }, { status: 409 });
    }
    const bytes = Buffer.from(content, 'utf8');
    if (bytes.byteLength > MAX_EDITABLE_SPACE_FILE_BYTES) {
      return NextResponse.json({ error: '在线编辑内容不能超过 1MB' }, { status: 413 });
    }
    const activeRun = await prisma.agentRun.findFirst({
      where: { spaceId, status: { in: EDIT_BLOCKING_RUN_STATUSES } },
      select: { id: true },
    });
    if (activeRun) return NextResponse.json({ error: '空间任务正在执行，暂时不能修改文件' }, { status: 409 });

    const root = await ensureSpaceRoot(userId, spaceId);
    const target = resolveSpacePath(userId, spaceId, file.relativePath);
    const [actualRoot, actualTarget] = await Promise.all([realpath(root), realpath(target)]);
    if (actualTarget !== actualRoot && !actualTarget.startsWith(actualRoot + path.sep)) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }
    const fileStat = await stat(actualTarget);
    if (!fileStat.isFile()) return NextResponse.json({ error: 'File not found' }, { status: 404 });

    await writeFile(actualTarget, bytes);
    const updatedAt = new Date();
    const updated = await prisma.spaceFile.update({
      where: { id: file.id },
      data: { size: bytes.byteLength, updatedAt },
    });
    await prisma.space.update({ where: { id: spaceId }, data: { updatedAt } });
    return NextResponse.json({ file: updated });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error.code === 'ENOENT') return NextResponse.json({ error: 'File not found' }, { status: 404 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
