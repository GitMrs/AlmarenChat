import { realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ensureSpaceRoot, getSpaceForUser, resolveSpacePath } from '@/app/api/_lib/spaces';
import { isPiSpaceTurnActive } from '@/lib/pi-runtime/space-session.mjs';
import { isWechatWorkspace } from '@/lib/workspace/wechat/wechat-workspace.mjs';
import { decorateSpaceFile } from '@/lib/space/space-asset-policy.mjs';

const RELATIVE_PATH = 'workspace/shared/content-strategy.md';
const INITIAL_CONTENT = '# 账号定位与写作风格\n\n## 读者与关注的问题\n\n## 内容方向与账号目标\n\n## 语气、篇幅与排版偏好\n\n## 事实来源与避免事项\n\n';

// Explicitly open or initialize the one shared strategy file; edits use the existing file editor.
export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    if (!isWechatWorkspace(space)) return NextResponse.json({ error: '当前空间不是公众号工作室' }, { status: 409 });
    const existing = await prisma.spaceFile.findFirst({ where: { spaceId, relativePath: RELATIVE_PATH } });
    if (existing) return NextResponse.json({ file: decorateSpaceFile(existing) });
    const activeRun = await prisma.agentRun.findFirst({ where: { spaceId, status: { in: ['QUEUED', 'PLANNING', 'RUNNING', 'SUMMARIZING', 'CANCEL_REQUESTED'] } }, select: { id: true } });
    if (activeRun || isPiSpaceTurnActive(spaceId)) return NextResponse.json({ error: '空间正在执行任务，请停止后再初始化账号定位' }, { status: 409 });
    const root = await ensureSpaceRoot(userId, spaceId);
    const target = resolveSpacePath(userId, spaceId, RELATIVE_PATH);
    const [actualRoot, actualDirectory] = await Promise.all([realpath(root), realpath(path.dirname(target))]);
    if (!actualDirectory.startsWith(actualRoot + path.sep)) return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    try { await writeFile(target, INITIAL_CONTENT, { encoding: 'utf8', flag: 'wx' }); }
    catch (error: any) { if (error.code !== 'EEXIST') throw error; }
    const actualTarget = await realpath(target);
    if (!actualTarget.startsWith(actualRoot + path.sep)) return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    const info = await stat(actualTarget);
    if (!info.isFile()) return NextResponse.json({ error: '账号定位路径不是文件' }, { status: 409 });
    const file = await prisma.$transaction(async (tx) => {
      const registered = await tx.spaceFile.findFirst({ where: { spaceId, relativePath: RELATIVE_PATH } });
      return registered || tx.spaceFile.create({ data: { spaceId, fileName: 'content-strategy.md', relativePath: RELATIVE_PATH, mimeType: 'text/markdown', size: info.size, status: 'READY' } });
    });
    return NextResponse.json({ file: decorateSpaceFile(file) });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
