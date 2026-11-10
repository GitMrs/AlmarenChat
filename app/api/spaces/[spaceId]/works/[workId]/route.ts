import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { templateLifecycleStage } from '@/lib/space/space-templates.mjs';
import { isWechatWorkspace } from '@/lib/workspace/wechat/wechat-workspace.mjs';
import { isPiSpaceTurnActive } from '@/lib/pi-runtime/space-session.mjs';
import { normalizeWechatPublishingSettings } from '@/lib/workspace/wechat/wechat-publishing-validation.mjs';

const WORK_STATUSES = new Set(['ACTIVE', 'COMPLETED', 'ARCHIVED']);

export async function PATCH(request: Request, { params }: { params: Promise<{ spaceId: string; workId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId, workId } = await params;
    const body = await request.json();
    const work = await prisma.spaceWork.findFirst({
      where: { id: workId, spaceId, space: { userId } },
      include: { space: { select: { templateSnapshot: true, templateId: true, workspaceType: true } } },
    });
    if (!work) return NextResponse.json({ error: '成果不存在' }, { status: 404 });
    const data: {
      title?: string;
      objective?: string | null;
      stage?: string | null;
      status?: string;
      completedAt?: Date | null;
      metadata?: any;
    } = {};
    if (body?.title !== undefined) {
      const title = String(body.title || '').trim();
      if (!title) return NextResponse.json({ error: '成果名称不能为空' }, { status: 400 });
      if (title.length > 120) return NextResponse.json({ error: '成果名称不能超过 120 字' }, { status: 400 });
      data.title = title;
    }
    if (body?.objective !== undefined) {
      const objective = String(body.objective || '').trim();
      if (objective.length > 4000) return NextResponse.json({ error: '成果目标不能超过 4000 字' }, { status: 400 });
      data.objective = objective || null;
    }
    if (body?.stage !== undefined) {
      const stage = body.stage === null ? null : String(body.stage || '').trim();
      const snapshot = work.space.templateSnapshot && typeof work.space.templateSnapshot === 'object'
        ? work.space.templateSnapshot as Record<string, unknown>
        : null;
      if (stage && !templateLifecycleStage(snapshot, stage)) {
        return NextResponse.json({ error: '成果阶段无效' }, { status: 400 });
      }
      data.stage = stage || null;
    }
    if (body?.status !== undefined) {
      const status = String(body.status || '').trim().toUpperCase();
      if (!WORK_STATUSES.has(status)) return NextResponse.json({ error: '成果状态无效' }, { status: 400 });
      data.status = status;
      data.completedAt = status === 'COMPLETED' ? work.completedAt || new Date() : null;
      if (status === 'COMPLETED') {
        const snapshot = work.space.templateSnapshot && typeof work.space.templateSnapshot === 'object'
          ? work.space.templateSnapshot as Record<string, unknown>
          : null;
        if (templateLifecycleStage(snapshot, 'ready')) data.stage = 'ready';
      }
    }
    if (body.wechatPublishing !== undefined) {
      if (!isWechatWorkspace(work.space)) return NextResponse.json({ error: '当前空间不是公众号工作室' }, { status: 409 });
      if (typeof body.expectedUpdatedAt !== 'string') return NextResponse.json({ error: '保存发布资料需要文章版本，请刷新后重试' }, { status: 400 });
      const settings = normalizeWechatPublishingSettings(body.wechatPublishing);
      if (settings.coverFileId) {
        const cover = await prisma.spaceFile.findFirst({ where: { id: settings.coverFileId, spaceId, status: 'READY', OR: [{ workId }, { workId: null }] } });
        if (!cover || !String(cover.mimeType || '').startsWith('image/')) return NextResponse.json({ error: '封面必须是当前文章或空间公共图片' }, { status: 400 });
      }
      data.metadata = { ...(work.metadata && typeof work.metadata === 'object' && !Array.isArray(work.metadata) ? work.metadata : {}), wechatPublishing: settings };
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ error: '没有可更新的成果字段' }, { status: 400 });
    if (body.expectedUpdatedAt !== undefined && isWechatWorkspace(work.space)) {
      const expected = new Date(body.expectedUpdatedAt);
      if (!Number.isFinite(expected.getTime())) return NextResponse.json({ error: '文章版本无效，请刷新后重试' }, { status: 400 });
      const activeRun = await prisma.agentRun.findFirst({ where: { spaceId, status: { in: ['QUEUED', 'PLANNING', 'RUNNING', 'SUMMARIZING', 'CANCEL_REQUESTED'] } }, select: { id: true } });
      if (activeRun || isPiSpaceTurnActive(spaceId)) return NextResponse.json({ error: '空间任务正在执行，暂时不能修改文章需求' }, { status: 409 });
      const changed = await prisma.spaceWork.updateMany({ where: { id: workId, spaceId, updatedAt: expected }, data });
      if (!changed.count) return NextResponse.json({ error: '文章已被其他操作更新，请刷新后再修改' }, { status: 409 });
      return NextResponse.json({ work: await prisma.spaceWork.findUnique({ where: { id: workId } }) });
    }
    const updated = await prisma.spaceWork.update({ where: { id: workId }, data });
    return NextResponse.json({ work: updated });
  } catch (error: any) {
    if (error.code === 'INVALID_INPUT') return NextResponse.json({ error: error.message }, { status: 400 });
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
