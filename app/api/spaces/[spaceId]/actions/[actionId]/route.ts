import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ensureSpaceRoot } from '@/app/api/_lib/spaces';
import { connectorActionDefinition } from '@/lib/connectors/registry.mjs';
import { buildWechatDraftSnapshot, selectAutomatedWechatDraftFiles } from '@/lib/connectors/wechat-draft-snapshot';

async function prepareFinalizationFollowUp(
  actionId: string,
  spaceId: string,
  userId: string
): Promise<{ draftPayload?: Record<string, any>; error?: string } | null> {
  const action = await prisma.spaceActionRequest.findFirst({
    where: { id: actionId, spaceId, space: { userId } },
  });
  const payload = action?.payload && typeof action.payload === 'object' ? action.payload as Record<string, any> : {};
  if (action?.kind !== 'FINALIZE_WORK' || payload.completionAction !== 'WECHAT_CREATE_DRAFT') return null;
  if (!action.workId) return { error: '自动化成果不存在，无法准备微信草稿' };
  try {
    const connector = await prisma.spaceConnector.findFirst({
      where: { spaceId, provider: 'WECHAT_OFFICIAL_ACCOUNT', enabled: true, status: 'READY' },
    });
    if (!connector) throw new Error('微信公众号连接器未启用或尚未验证');
    const files = await prisma.spaceFile.findMany({ where: { spaceId, workId: action.workId, status: 'READY' } });
    const { articleFile, coverFile, workFiles } = selectAutomatedWechatDraftFiles(files, action.workId);
    const draftPayload = await buildWechatDraftSnapshot({
      root: await ensureSpaceRoot(userId, spaceId),
      articleFile,
      coverFile,
      availableFiles: workFiles,
      themeId: typeof payload.completionConfig?.themeId === 'string' ? payload.completionConfig.themeId : undefined,
    });
    return { draftPayload };
  } catch (error: any) {
    return { error: String(error?.message || '无法准备微信草稿').slice(0, 1000) };
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ spaceId: string; actionId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId, actionId } = await params;
    const body = await request.json();
    const decision = body?.decision === 'approve' ? 'approve' : body?.decision === 'reject' ? 'reject' : null;
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 1000) : '';
    if (!decision) return NextResponse.json({ error: '审批决定无效' }, { status: 400 });
    const preparedFollowUp = decision === 'approve'
      ? await prepareFinalizationFollowUp(actionId, spaceId, userId)
      : null;
    const timestamp = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const action = await tx.spaceActionRequest.findFirst({
        where: { id: actionId, spaceId, space: { userId } },
        include: { work: true },
      });
      if (!action) throw new Error('动作请求不存在');
      if (action.status !== 'PENDING') throw new Error('动作请求已经处理');
      const connectorAction = connectorActionDefinition('WECHAT_OFFICIAL_ACCOUNT', action.kind);
      if (action.kind !== 'FINALIZE_WORK' && !connectorAction) throw new Error('当前动作类型尚未接入执行器');
      if (connectorAction && (action.riskLevel !== 'HIGH' || connectorAction.approvalRequired !== true)) {
        throw new Error('外部动作审批策略无效');
      }
      const claimed = await tx.spaceActionRequest.updateMany({
        where: { id: action.id, status: 'PENDING' },
        data: { status: decision === 'approve' ? 'APPROVED' : 'REJECTED', decidedBy: userId, decidedAt: timestamp },
      });
      if (claimed.count !== 1) throw new Error('动作请求已经处理');
      let work = action.work;
      let followUpAction = null;
      if (decision === 'approve' && action.kind === 'FINALIZE_WORK') {
        if (!action.workId || !work) throw new Error('待定稿成果不存在');
        work = await tx.spaceWork.update({
          where: { id: action.workId },
          data: { status: 'COMPLETED', stage: 'ready', completedAt: timestamp },
        });
        await tx.spaceActionRequest.update({
          where: { id: action.id },
          data: {
            status: 'COMPLETED',
            result: { workId: work.id, status: 'COMPLETED' },
            completedAt: timestamp,
          },
        });
        if (preparedFollowUp?.draftPayload) {
          followUpAction = await tx.spaceActionRequest.upsert({
            where: { idempotencyKey: `automation-wechat-draft:${action.automationExecutionId || action.id}` },
            create: {
              spaceId,
              workId: action.workId,
              runId: action.runId,
              automationExecutionId: action.automationExecutionId,
              kind: 'WECHAT_CREATE_DRAFT',
              riskLevel: 'HIGH',
              title: `创建微信草稿：${preparedFollowUp.draftPayload.article.title}`.slice(0, 160),
              status: 'PENDING',
              payload: preparedFollowUp.draftPayload,
              idempotencyKey: `automation-wechat-draft:${action.automationExecutionId || action.id}`,
              requestedAt: timestamp,
            },
            update: {},
            include: {
              work: true,
              run: { select: { status: true, result: true, error: true, completedAt: true } },
              connectorExecution: true,
            },
          });
          await tx.spaceMessage.create({
            data: {
              spaceId,
              role: 'assistant',
              speakerAgentId: 'space-coordinator',
              content: `“${work.title}”已生成不可变发布快照，请确认是否创建微信草稿。`,
              attachments: [{ type: 'action_request', actionId: followUpAction.id, kind: 'WECHAT_CREATE_DRAFT', workId: work.id, runId: action.runId }],
              sourceKey: `automation-wechat-draft-request:${action.id}`,
            },
          });
        } else if (preparedFollowUp?.error) {
          await tx.spaceMessage.create({
            data: {
              spaceId,
              role: 'assistant',
              speakerAgentId: 'space-coordinator',
              content: `“${work.title}”已确认定稿，但未能自动准备微信草稿：${preparedFollowUp.error}。你可以整理正文和封面后手动创建草稿。`,
              attachments: [{ type: 'automation_follow_up_failed', actionId: action.id, kind: 'WECHAT_CREATE_DRAFT', workId: work.id, reason: preparedFollowUp.error }],
              sourceKey: `automation-wechat-draft-fallback:${action.id}`,
            },
          });
        }
      } else if (decision === 'approve' && connectorAction) {
        const connector = await tx.spaceConnector.findFirst({
          where: { spaceId, provider: 'WECHAT_OFFICIAL_ACCOUNT', enabled: true },
        });
        if (!connector) throw new Error('微信公众号连接器未启用');
        await tx.spaceConnectorExecution.create({
          data: {
            connectorId: connector.id,
            actionRequestId: action.id,
            operation: action.kind,
            status: 'QUEUED',
            requestSummary: action.kind === 'WECHAT_CREATE_DRAFT'
              ? { title: (action.payload as any)?.article?.title || action.title }
              : { mediaId: (action.payload as any)?.mediaId || null },
          },
        });
      }
      await tx.spaceMessage.create({
        data: {
          spaceId,
          role: 'assistant',
          speakerAgentId: 'space-coordinator',
          content: action.kind === 'FINALIZE_WORK'
            ? decision === 'approve'
              ? `“${work?.title || '自动化成果'}”已确认定稿。`
              : `已暂不定稿“${work?.title || '自动化成果'}”${reason ? `：${reason}` : '，可以继续修改后再确认。'}`
            : decision === 'approve'
              ? `已批准“${action.title}”，等待 Worker 执行。`
              : `已取消“${action.title}”${reason ? `：${reason}` : '。'}`,
          attachments: [{ type: 'action_decision', actionId: action.id, decision, workId: action.workId, reason }],
          sourceKey: `action-decision:${action.id}`,
        },
      });
      const updated = await tx.spaceActionRequest.findUnique({
        where: { id: action.id },
        include: {
          work: true,
          run: { select: { status: true, result: true, error: true, completedAt: true } },
          connectorExecution: true,
        },
      });
      return { action: updated, work, followUpAction };
    });
    return NextResponse.json(result);
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (['动作请求不存在', '待定稿成果不存在'].includes(error.message)) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error.message === '动作请求已经处理') return NextResponse.json({ error: error.message }, { status: 409 });
    if (['微信公众号连接器未启用', '外部动作审批策略无效'].includes(error.message)) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
