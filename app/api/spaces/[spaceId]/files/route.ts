import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ensureSpaceRoot, getSpaceForUser, resolveSpacePath } from '@/app/api/_lib/spaces';
import { decorateSpaceFile } from '@/lib/space-asset-policy.mjs';

const MAX_FILE_SIZE = 2 * 1024 * 1024;

function safeFileName(name: string) {
  return path.basename(name || 'untitled.txt').replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(0, 120) || 'untitled.txt';
}

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    const files = await prisma.spaceFile.findMany({
      where: { spaceId },
      include: { work: true },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    const visibleFiles = files.filter((file, index) => (
      files.findIndex((candidate) => candidate.relativePath === file.relativePath) === index
    ));
    return NextResponse.json({ files: visibleFiles.map(decorateSpaceFile) });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    const formData = await request.formData();
    const file = formData.get('file');
    const rawRole = typeof formData.get('role') === 'string' ? (formData.get('role') as string).trim() : '';
    const rawWorkId = typeof formData.get('workId') === 'string' ? (formData.get('workId') as string).trim() : '';
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: '单个空间资料不能超过 2MB。' }, { status: 400 });
    }

    await ensureSpaceRoot(userId, spaceId);

    const cleanName = safeFileName(file.name);
    let relativePath: string;
    let workId: string | null = null;

    if (rawRole === 'SHARED') {
      relativePath = `workspace/shared/${cleanName}`;
    } else if (rawRole === 'FOUNDATION') {
      relativePath = `workspace/foundation/${cleanName}`;
    } else if (rawRole === 'OUTPUT' && rawWorkId && rawWorkId !== 'all') {
      workId = rawWorkId;
      relativePath = `workspace/works/${rawWorkId}/${cleanName}`;
    } else if (rawRole === 'OUTPUT') {
      relativePath = `workspace/works/${cleanName}`;
    } else if (rawRole === 'ARCHIVE') {
      relativePath = `workspace/archive/${cleanName}`;
    } else {
      const fileName = `${Date.now()}-${cleanName}`;
      relativePath = `workspace/inbox/${fileName}`;
    }

    if (workId) {
      const workExists = await prisma.spaceWork.findFirst({
        where: { id: workId, spaceId },
        select: { id: true },
      });
      if (!workExists) {
        workId = null;
      }
    }

    const target = resolveSpacePath(userId, spaceId, relativePath);
    const bytes = Buffer.from(await file.arrayBuffer());
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);

    const existing = await prisma.spaceFile.findFirst({
      where: { spaceId, relativePath },
    });

    let record;
    if (existing) {
      record = await prisma.spaceFile.update({
        where: { id: existing.id },
        data: {
          fileName: file.name,
          mimeType: file.type || null,
          size: file.size,
          workId: workId ?? existing.workId,
          updatedAt: new Date(),
        },
        include: { work: true },
      });
    } else {
      record = await prisma.spaceFile.create({
        data: {
          spaceId,
          fileName: file.name,
          mimeType: file.type || null,
          size: file.size,
          relativePath,
          workId,
        },
        include: { work: true },
      });
    }

    await prisma.space.update({ where: { id: spaceId }, data: { updatedAt: new Date() } });
    return NextResponse.json({ file: decorateSpaceFile(record) });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
