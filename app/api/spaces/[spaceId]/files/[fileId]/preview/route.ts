import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser } from '@/app/api/_lib/spaces';
import { signSpacePreviewToken } from '@/lib/space-preview-token.mjs';
import { logicalWorkspaceRelativePath } from '@/lib/space-work-paths.mjs';

function encodedPath(value: string) {
  return value.split('/').map((part) => encodeURIComponent(part)).join('/');
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; fileId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { spaceId, fileId } = await params;
    const body = await request.json().catch(() => ({}));
    const externalImages = body?.externalImages === true;
    const externalDependencies = body?.externalDependencies === true;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    const file = await prisma.spaceFile.findFirst({ where: { id: fileId, spaceId } });
    if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (!/\.html?$/i.test(file.fileName)) {
      return NextResponse.json({ error: '当前文件类型不支持网页预览' }, { status: 415 });
    }

    const stagedTask = file.taskId && ['GENERATING', 'WAITING_APPROVAL'].includes(file.status)
      ? await prisma.agentTask.findUnique({ where: { id: file.taskId }, select: { attempt: true } })
      : null;
    const scope = stagedTask
      ? { userId, spaceId, root: 'staging', taskId: file.taskId, attempt: stagedTask.attempt, externalImages, externalDependencies }
      : { userId, spaceId, root: 'space', externalImages, externalDependencies };
    const token = signSpacePreviewToken(scope);
    const relativePath = stagedTask && file.relativePath.startsWith('workspace/')
      ? logicalWorkspaceRelativePath(file.workId, file.relativePath)
      : file.relativePath;
    const rootUrl = `/api/space-previews/${token}/`;
    return NextResponse.json({
      url: `${rootUrl}${encodedPath(relativePath)}`,
      rootUrl,
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
