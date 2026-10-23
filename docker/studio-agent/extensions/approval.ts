import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * Studio 工具审批扩展。
 *
 * 运行在沙箱容器内，通过 RPC 的 extension_ui_request / extension_ui_response
 * 子协议把「是否允许执行工具」转发给宿主，由宿主弹出审批并回传结果。
 *
 * STUDIO_APPROVAL_MODE:
 *   never     - 全部放行
 *   dangerous - 仅写文件与 shell 需要确认
 *   always    - 所有工具都需要确认
 */
const MODE = String(process.env.STUDIO_APPROVAL_MODE || 'dangerous');
const DANGEROUS_TOOLS = new Set(['write', 'edit', 'bash', 'patch', 'shell']);
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

function needsApproval(toolName: string): boolean {
  if (MODE === 'never') return false;
  if (MODE === 'always') return true;
  return DANGEROUS_TOOLS.has(String(toolName || ''));
}

function describeInput(toolName: string, input: Record<string, unknown>): string {
  if (typeof input.path === 'string' && input.path) return String(input.path).slice(0, 300);
  if (typeof input.file_path === 'string' && input.file_path) return String(input.file_path).slice(0, 300);
  if (typeof input.command === 'string' && input.command) return String(input.command).slice(0, 300);
  if (typeof input.pattern === 'string' && input.pattern) return String(input.pattern).slice(0, 300);
  return toolName;
}

export default function studioApproval(pi: ExtensionAPI) {
  pi.on('tool_call', async (event: any, ctx: any) => {
    const toolName = String(event?.toolName || 'tool');
    if (!needsApproval(toolName)) return undefined;

    const input = (event?.input && typeof event.input === 'object' ? event.input : {}) as Record<string, unknown>;
    const confirmed = await ctx.ui.confirm(
      `是否允许执行 ${toolName}？`,
      describeInput(toolName, input),
      { timeout: APPROVAL_TIMEOUT_MS }
    );

    if (!confirmed) {
      return { block: true, reason: '用户拒绝或审批超时，该工具未执行' };
    }
    return undefined;
  });
}
