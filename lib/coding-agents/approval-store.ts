export type ApprovalAction = 'approve' | 'deny';
export type StudioApprovalMode = 'dangerous' | 'always' | 'never';

export interface ApprovalDecision {
  action: ApprovalAction;
  reason?: string;
  timestamp: number;
}

export interface ApprovalRequest {
  id: string;
  runId: string;
  userId: string;
  toolCallId: string;
  toolName: string;
  toolPreview: string;
  args: Record<string, any>;
  timeoutMs: number;
  createdAt: number;
}

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
  timer: NodeJS.Timeout;
}

class StudioApprovalStore {
  private pending = new Map<string, PendingApproval>();

  /**
   * 注册并挂起审批请求，返回审批 ID 与等待用户决策的 Promise
   */
  createApproval(
    request: Omit<ApprovalRequest, 'id' | 'createdAt'>
  ): { approvalId: string; promise: Promise<ApprovalDecision> } {
    const id = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const fullRequest: ApprovalRequest = {
      ...request,
      id,
      createdAt: Date.now(),
    };

    let resolver!: (decision: ApprovalDecision) => void;
    const promise = new Promise<ApprovalDecision>((res) => {
      resolver = res;
    });

    const timeoutMs = request.timeoutMs || 300_000;
    const timer = setTimeout(() => {
      this.resolveApproval(
        id,
        request.userId,
        {
          action: 'deny',
          reason: '审批超时（5分钟未响应），系统已自动安全拒绝。',
          timestamp: Date.now(),
        },
        true // isTimeout
      );
    }, timeoutMs);

    this.pending.set(id, { request: fullRequest, resolve: resolver, timer });
    return { approvalId: id, promise };
  }

  /**
   * 提交审批结果（批准或拒绝）
   */
  resolveApproval(
    approvalId: string,
    userId: string,
    decision: ApprovalDecision,
    isTimeout = false
  ): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;

    if (!isTimeout && entry.request.userId !== userId) {
      throw new Error('无权审批此请求：操作用户不匹配');
    }

    clearTimeout(entry.timer);
    this.pending.delete(approvalId);
    entry.resolve(decision);
    return true;
  }

  /**
   * 按 runId 清理所有挂起的审批（如 SSE 连接被客户端断开、主动取消等）
   */
  cancelAllByRun(runId: string, reason = '连接已断开，操作已自动终止'): void {
    for (const [id, entry] of this.pending.entries()) {
      if (entry.request.runId === runId) {
        clearTimeout(entry.timer);
        this.pending.delete(id);
        entry.resolve({ action: 'deny', reason, timestamp: Date.now() });
      }
    }
  }

  /**
   * 获取当前挂起的审批信息
   */
  getPending(approvalId: string): ApprovalRequest | null {
    return this.pending.get(approvalId)?.request || null;
  }
}

// 导出进程内单例
export const approvalStore = new StudioApprovalStore();
