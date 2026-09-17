import { requireAuth } from '@/app/api/_lib/auth';
import { approvalStore, ApprovalAction } from '@/lib/coding-agents/approval-store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json().catch(() => ({}));
    const { approvalId, action, reason } = body as {
      approvalId?: string;
      action?: ApprovalAction;
      reason?: string;
    };

    if (!approvalId || typeof approvalId !== 'string') {
      return Response.json({ error: '缺少 approvalId 参数' }, { status: 400 });
    }

    if (!action || !['approve', 'deny'].includes(action)) {
      return Response.json({ error: '无效的操作指令 action (仅支持 approve 或 deny)' }, { status: 400 });
    }

    const resolved = approvalStore.resolveApproval(approvalId, userId, {
      action,
      reason: reason || (action === 'deny' ? '用户手动拒绝' : undefined),
      timestamp: Date.now(),
    });

    if (!resolved) {
      return Response.json(
        { error: '该工具审批请求已过期、已处理或不存在' },
        { status: 404 }
      );
    }

    return Response.json({
      success: true,
      approvalId,
      action,
      message: action === 'approve' ? '已批准执行该工具' : '已拒绝执行该工具',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes('无权') ? 403 : 500;
    return Response.json({ error: msg }, { status });
  }
}
