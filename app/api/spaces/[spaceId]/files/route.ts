import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ensureSpaceRoot, getSpaceForUser, resolveSpacePath } from '@/app/api/_lib/spaces';

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
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return NextResponse.json({ files });
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
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: '单个空间资料不能超过 2MB。' }, { status: 400 });
    }

    await ensureSpaceRoot(userId, spaceId);
    const fileName = `${Date.now()}-${safeFileName(file.name)}`;
    const relativePath = `files/${fileName}`;
    const target = resolveSpacePath(userId, spaceId, relativePath);
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(target, bytes);

    const record = await prisma.spaceFile.create({
      data: {
        spaceId,
        fileName: file.name,
        mimeType: file.type || null,
        size: file.size,
        relativePath,
      },
    });
    await prisma.space.update({ where: { id: spaceId }, data: { updatedAt: new Date() } });
    return NextResponse.json({ file: record });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
