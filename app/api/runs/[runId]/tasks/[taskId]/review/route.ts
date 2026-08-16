import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getAgentRunForUser } from '@/app/api/_lib/agent-runs';
import { applyWorkspaceAttempt, discardWorkspaceAttempt, recoverWorkspaceAttemptApplication } from '@/lib/workspace-staging.mjs';
import { appendAgentRunEvent } from '@/app/api/_lib/agent-run-events';

const REVIEW_ACTIONS = new Set(['approve', 'retry', 'skip']);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string; taskId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { runId, taskId } = await params;
    const body = await request.json();
    const action = typeof body.action === 'string' ? body.action : '';
    const feedback = typeof body.feedback === 'string' ? body.feedback.trim() : '';
    if (!REVIEW_ACTIONS.has(action)) return NextResponse.json({ error: 'Unsupported review action' }, { status: 400 });
    if (action === 'retry' && !feedback) return NextResponse.json({ error: '请填写需要修改的内容' }, { status: 400 });
    if (feedback.length > 4_000) return NextResponse.json({ error: '修正要求不能超过 4000 字' }, { status: 400 });

    const existing = await getAgentRunForUser(runId, userId);
    if (!existing) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    const task = existing.tasks.find((item) => item.id === taskId);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (existing.status !== 'WAITING_APPROVAL' || task.status !== 'WAITING_APPROVAL') {
      return NextResponse.json({ error: '当前步骤不在待审核状态' }, { status: 409 });
    }
    const usesWorkspace = task.mode !== 'advisor';
    const latestAuditEvent = [...existing.events].reverse().find((event) => {
      if (event.type !== 'RESEARCH_RESULT_AUDITED' || !event.payload || typeof event.payload !== 'object') return false;
      const payload = event.payload as Record<string, unknown>;
      return payload.taskId === taskId;
    });
    const latestAuditPayload = latestAuditEvent?.payload && typeof latestAuditEvent.payload === 'object'
      ? latestAuditEvent.payload as Record<string, unknown>
      : null;
    const latestAudit = latestAuditPayload?.audit && typeof latestAuditPayload.audit === 'object'
      ? latestAuditPayload.audit as Record<string, unknown>
      : null;
    if (action === 'approve' && latestAudit?.accepted === false) {
      return NextResponse.json({ error: '来源验收未通过，不能作为正常结果继续。请补充要求后重做，或跳过此步骤。' }, { status: 409 });
    }

    let manifest = usesWorkspace ? await prisma.agentArtifactManifest.findUnique({
      where: { taskId_attempt: { taskId, attempt: task.attempt } },
    }) : null;
    if (action === 'approve' && usesWorkspace && !manifest) {
      return NextResponse.json({ error: '当前步骤缺少安全工作区基线，请选择重做后再确认' }, { status: 409 });
    }
    const baseline = (manifest?.baseline || { files: [] }) as { files?: Array<{ path: string; size: number; mtimeMs: number; sha256?: string | null }> };
    const entries = Array.isArray(manifest?.entries)
      ? manifest.entries as Array<{ path: string; change: 'CREATED' | 'MODIFIED' | 'DELETED' }>
      : [];
    const stagingOptions = {
      projectRoot: process.cwd(),
      userId,
      spaceId: existing.spaceId,
      taskId,
      attempt: task.attempt,
    };
    if (usesWorkspace && manifest?.status === 'APPLYING') {
      await recoverWorkspaceAttemptApplication(stagingOptions, baseline, entries);
      manifest = await prisma.agentArtifactManifest.update({
        where: { id: manifest.id },
        data: { status: 'VALIDATED' },
      });
    }
    if (action === 'approve' && usesWorkspace && manifest?.status !== 'VALIDATED') {
      return NextResponse.json({ error: '工作区产物尚未通过检查，不能确认' }, { status: 409 });
    }
    let application: Awaited<ReturnType<typeof applyWorkspaceAttempt>> | null = null;
    if (action === 'approve' && usesWorkspace) {
      await prisma.agentArtifactManifest.update({ where: { id: manifest!.id }, data: { status: 'APPLYING' } });
      try {
        application = await applyWorkspaceAttempt(stagingOptions, baseline, entries);
      } catch (error) {
        await prisma.agentArtifactManifest.update({ where: { id: manifest!.id }, data: { status: 'VALIDATED' } });
        throw error;
      }
    }

    const timestamp = new Date();
    try {
      await prisma.$transaction(async (transaction) => {
      const taskData = action === 'approve'
        ? { status: 'COMPLETED', reviewedAt: timestamp, reviewFeedback: null }
        : action === 'retry'
          ? {
              status: 'PENDING',
              result: null,
              error: null,
              reviewFeedback: feedback,
              attempt: { increment: 1 },
              modelRequestLimit: { increment: task.mode === 'advisor' ? 2 : 8 },
              startedAt: null,
              completedAt: null,
              reviewedAt: null,
            }
          : { status: 'SKIPPED', reviewedAt: timestamp };
      const changed = await transaction.agentTask.updateMany({
        where: { id: taskId, runId, status: 'WAITING_APPROVAL' },
        data: taskData,
      });
      if (changed.count !== 1) throw new Error('当前步骤已经处理');

      if (manifest) {
        await transaction.agentArtifactManifest.update({
          where: { id: manifest.id },
          data: { status: action === 'approve' ? 'APPLIED' : 'DISCARDED' },
        });
      }

      if (action === 'approve' && usesWorkspace) {
        const changedPaths = entries
          .filter((entry) => entry.change !== 'DELETED')
          .map((entry) => `workspace/${entry.path}`);
        const deletedPaths = entries
          .filter((entry) => entry.change === 'DELETED')
          .map((entry) => `workspace/${entry.path}`);
        const stagedFiles = await transaction.spaceFile.findMany({
          where: { spaceId: existing.spaceId, runId, taskId },
          select: { id: true },
        });
        if (changedPaths.length > 0) {
          await transaction.spaceFile.deleteMany({
            where: {
              spaceId: existing.spaceId,
              relativePath: { in: changedPaths },
              id: { notIn: stagedFiles.map((file) => file.id) },
            },
          });
        }
        if (deletedPaths.length > 0) {
          await transaction.spaceFile.deleteMany({
            where: { spaceId: existing.spaceId, relativePath: { in: deletedPaths } },
          });
        }
        await transaction.spaceFile.updateMany({
          where: { id: { in: stagedFiles.map((file) => file.id) } },
          data: { status: 'READY', updatedAt: timestamp },
        });
      } else {
        await transaction.spaceFile.deleteMany({ where: { spaceId: existing.spaceId, runId, taskId } });
      }
      await transaction.agentRun.update({
        where: { id: runId },
        data: {
          status: 'QUEUED',
          updatedAt: timestamp,
          ...(action === 'retry' ? { modelRequestLimit: { increment: task.mode === 'advisor' ? 2 : 8 } } : {}),
        },
      });
      await appendAgentRunEvent(transaction, runId, {
          type: action === 'approve' ? 'TASK_APPROVED' : action === 'retry' ? 'TASK_REVISION_REQUESTED' : 'TASK_SKIPPED',
          message: action === 'approve'
            ? `已确认${task.agentName}的阶段结果`
            : action === 'retry'
              ? `已要求${task.agentName}重做当前步骤`
              : `已跳过${task.agentName}的当前步骤`,
          payload: {
            taskId,
            agentId: task.agentId,
            attempt: action === 'retry' ? task.attempt + 1 : task.attempt,
            ...(action === 'retry' ? { feedback, previousResult: task.result } : {}),
          },
          taskId,
          agentId: task.agentId,
          attempt: action === 'retry' ? task.attempt + 1 : task.attempt,
          actor: 'user',
      });
      });
    } catch (error) {
      await application?.rollback();
      if (manifest && action === 'approve') {
        await prisma.agentArtifactManifest.update({ where: { id: manifest.id }, data: { status: 'VALIDATED' } });
      }
      throw error;
    }
    try {
      if (usesWorkspace) await discardWorkspaceAttempt(stagingOptions);
    } catch (error) {
      await prisma.$transaction((transaction) => appendAgentRunEvent(transaction, runId, {
          type: 'WORKSPACE_STAGING_CLEANUP_FAILED',
          message: '任务暂存区清理失败',
          payload: { taskId, error: error instanceof Error ? error.message : String(error) },
          taskId,
          agentId: task.agentId,
          attempt: task.attempt,
          actor: 'system',
      }));
    }

    const run = await getAgentRunForUser(runId, userId);
    return NextResponse.json({ run });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error.code === 'WORKSPACE_CONFLICT') return NextResponse.json({ error: error.message }, { status: 409 });
    if (error.message === '当前步骤已经处理') return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
