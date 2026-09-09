import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ensureSpaceRoot, getSpaceForUser } from '@/app/api/_lib/spaces';
import { randomUUID } from 'node:crypto';
import { buildWechatDraftSnapshot } from '@/lib/connectors/wechat-draft-snapshot';

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const include = {
      work: true,
      run: { select: { status: true, result: true, error: true, completedAt: true } },
      connectorExecution: true,
    } as const;
    const [pending, history] = await Promise.all([
      prisma.spaceActionRequest.findMany({ where: { spaceId, status: 'PENDING' }, include, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.spaceActionRequest.findMany({ where: { spaceId, status: { not: 'PENDING' } }, include, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    const actions = [...pending, ...history];
    return NextResponse.json({ actions });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const body = await request.json().catch(() => ({}));
    if (body.kind !== 'WECHAT_CREATE_DRAFT') return NextResponse.json({ error: '不支持的动作类型' }, { status: 400 });
    const requestId = typeof body.requestId === 'string' && /^[a-zA-Z0-9_-]{12,100}$/.test(body.requestId) ? body.requestId : '';
    if (!requestId) return NextResponse.json({ error: '动作请求标识无效' }, { status: 400 });
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    if (space.templateId !== 'wechat-article') return NextResponse.json({ error: '当前空间不是公众号创作室' }, { status: 409 });
    const connector = await prisma.spaceConnector.findUnique({ where: { spaceId_provider: { spaceId, provider: 'WECHAT_OFFICIAL_ACCOUNT' } } });
    if (!connector?.enabled) return NextResponse.json({ error: '请先启用微信公众号连接器' }, { status: 409 });
    if (connector.status !== 'READY') return NextResponse.json({ error: '请先验证微信公众号连接是否可用' }, { status: 409 });
    const articleFileId = typeof body.articleFileId === 'string' ? body.articleFileId : '';
    const coverFileId = typeof body.coverFileId === 'string' ? body.coverFileId : '';
    const [articleFile, coverFile, allFiles] = await Promise.all([
      prisma.spaceFile.findFirst({ where: { id: articleFileId, spaceId, status: 'READY' } }),
      prisma.spaceFile.findFirst({ where: { id: coverFileId, spaceId, status: 'READY' } }),
      prisma.spaceFile.findMany({ where: { spaceId, status: 'READY' } }),
    ]);
    if (!articleFile || !/\.(?:md|markdown)$/i.test(articleFile.fileName)) return NextResponse.json({ error: '请选择已完成的 Markdown 文章' }, { status: 400 });
    if (!coverFile || !String(coverFile.mimeType || '').startsWith('image/')) return NextResponse.json({ error: '请选择一张空间图片作为封面' }, { status: 400 });
    if (articleFile.workId && coverFile.workId && articleFile.workId !== coverFile.workId) return NextResponse.json({ error: '封面必须属于当前文章成果' }, { status: 400 });
    const draftPayload = await buildWechatDraftSnapshot({
      root: await ensureSpaceRoot(userId, spaceId),
      articleFile,
      coverFile,
      availableFiles: allFiles,
      themeId: typeof body.themeId === 'string' ? body.themeId : undefined,
    });
    const timestamp = new Date();
    const action = await prisma.spaceActionRequest.upsert({
      where: { idempotencyKey: `wechat-draft:${spaceId}:${requestId}` },
      create: {
        id: randomUUID(), spaceId, workId: articleFile.workId, runId: articleFile.runId,
        kind: 'WECHAT_CREATE_DRAFT', riskLevel: 'HIGH', title: `创建微信草稿：${draftPayload.article.title}`.slice(0, 160),
        status: 'PENDING', idempotencyKey: `wechat-draft:${spaceId}:${requestId}`,
        payload: draftPayload,
        requestedAt: timestamp,
      },
      update: {},
      include: { work: true, run: { select: { status: true, result: true, error: true, completedAt: true } }, connectorExecution: true },
    });
    return NextResponse.json({ action }, { status: action.status === 'PENDING' ? 201 : 200 });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error.code === 'ENOENT') return NextResponse.json({ error: '空间文件不存在' }, { status: 404 });
    if (error instanceof TypeError && /encoded data/i.test(error.message)) return NextResponse.json({ error: '文章不是有效的 UTF-8 文本' }, { status: 415 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
