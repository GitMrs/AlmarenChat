import React from 'react';
import {
  Wrench,
  ChevronDown,
  Loader2,
  CheckCircle,
  Code,
  Terminal,
  Copy,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ToolInvocation } from '../../types';

interface ToolCardProps {
  tool: ToolInvocation;
  isExpanded: boolean;
  onToggleExpand: (toolId: string) => void;
  approvingToolId: string | null;
  onDecision: (approvalId: string, action: 'approve' | 'deny', toolId: string) => void;
  copiedToolResult: boolean;
  onCopyResult: (text: string) => void;
}

export const ToolCard: React.FC<ToolCardProps> = ({
  tool,
  isExpanded,
  onToggleExpand,
  approvingToolId,
  onDecision,
  copiedToolResult,
  onCopyResult,
}) => {
  return (
    <div className="rounded-2xl border border-black/[0.08] bg-white overflow-hidden shadow-2xs transition-all hover:border-black/[0.14]">
      {/* Top Clickable Bar */}
      <div
        onClick={() => onToggleExpand(tool.id)}
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-slate-50/70 transition-colors group select-none text-xs"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={cn(
              'w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors',
              tool.status === 'running'
                ? 'bg-amber-50 text-amber-600 border border-amber-200'
                : tool.status === 'waiting_approval'
                ? 'bg-amber-100 text-amber-700 border border-amber-300'
                : tool.status === 'denied'
                ? 'bg-rose-50 text-rose-600 border border-rose-200'
                : tool.status === 'done'
                ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                : 'bg-slate-100 text-slate-500 border border-black/[0.06]'
            )}
          >
            <Wrench size={12} />
          </div>
          <span className="font-mono font-bold text-slate-700 text-xs truncate">
            {tool.name}
          </span>
          <span className="text-slate-400 text-xs truncate max-w-[260px] sm:max-w-md">
            {tool.preview}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          {tool.sessionId && (
            <span className="text-[10px] text-slate-500 font-mono bg-slate-100 px-1.5 py-0.5 rounded-md">
              实时流
            </span>
          )}
          {tool.status === 'waiting_approval' && (
            <span className="flex items-center gap-1 text-[11px] text-amber-600 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-full font-semibold animate-pulse">
              <ShieldAlert size={12} className="text-amber-600" />
              <span>待审批</span>
            </span>
          )}
          {tool.status === 'denied' && (
            <span className="flex items-center gap-1 text-[11px] text-rose-600 bg-rose-50 border border-rose-200/80 px-2 py-0.5 rounded-full font-medium">
              <XCircle size={12} className="text-rose-500" />
              <span>已拒绝</span>
            </span>
          )}
          {tool.status === 'running' && (
            <span className="flex items-center gap-1 text-[11px] text-amber-600 font-medium">
              <Loader2 size={12} className="animate-spin" />
              <span className="text-[10px]">运行中</span>
            </span>
          )}
          {tool.status === 'done' && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-semibold">
              <CheckCircle size={12} />
            </span>
          )}
          {tool.status === 'failed' && <span className="w-2 h-2 rounded-full bg-rose-500" />}
          <ChevronDown
            size={14}
            className={cn(
              'text-slate-400 group-hover:text-slate-700 transition-transform duration-200',
              isExpanded && 'rotate-180 text-slate-800'
            )}
          />
        </div>
      </div>

      {/* Inline Expanded Dropdown Panel */}
      {isExpanded && (
        <div className="border-t border-black/[0.06] bg-[#fbfaf7]/60 p-3 space-y-2.5 animate-fadeIn text-xs">
          {/* Waiting Approval Action Card */}
          {tool.status === 'waiting_approval' && tool.approvalId && (
            <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-2xl space-y-2.5">
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-xl bg-amber-100 border border-amber-300 flex items-center justify-center flex-shrink-0 mt-0.5 text-amber-700">
                  <ShieldAlert size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-amber-900">高危操作审批申请</h4>
                    <span className="text-[10px] text-amber-700 font-mono bg-amber-100/60 px-1.5 py-0.5 rounded">
                      5分钟超时自动拒绝
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
                    {tool.name === 'write' || tool.name === 'write_file'
                      ? 'AI 申请向您的项目写入或修改文件。请核实文件路径及修改目标，确认无误后批准执行。'
                      : tool.name === 'delegate' || tool.name === 'delegate_task'
                      ? 'AI 申请委派子智能体在您的工作区执行终端命令与任务。请核对指令后决定是否批准。'
                      : 'AI 申请执行敏感工具操作，请核实后决定是否批准。'}
                  </p>
                </div>
              </div>

              {/* Call detail breakdown */}
              {tool.args && (
                <div className="bg-white/90 border border-amber-200/60 rounded-xl p-2.5 space-y-1.5 text-[11px]">
                  {tool.args.path && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-slate-500 font-medium w-16 flex-shrink-0">目标文件:</span>
                      <span className="font-mono text-slate-800 font-semibold break-all">
                        {tool.args.path}
                      </span>
                    </div>
                  )}
                  {tool.args.agent && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-slate-500 font-medium w-16 flex-shrink-0">委派智能体:</span>
                      <span className="font-mono text-slate-800 font-semibold">
                        {tool.args.agent}
                      </span>
                    </div>
                  )}
                  {tool.args.goal && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-slate-500 font-medium w-16 flex-shrink-0">任务目标:</span>
                      <span className="text-slate-700 break-all leading-relaxed flex-1 min-w-0">
                        {tool.args.goal}
                      </span>
                    </div>
                  )}
                  {tool.args.context && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-slate-500 font-medium w-16 flex-shrink-0">补充背景:</span>
                      <span className="text-slate-600 break-all leading-relaxed flex-1 min-w-0">
                        {tool.args.context}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* write_file content preview — approving a write means reviewing what gets written */}
              {typeof tool.args?.content === 'string' && tool.args.content.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-500">
                    <span>拟写入内容（共 {tool.args.content.length} 字符）:</span>
                    <span className="font-normal text-slate-400">前 1500 字符预览</span>
                  </div>
                  <pre className="bg-white/90 border border-amber-200/60 rounded-xl p-2.5 font-mono text-[10px] text-slate-700 whitespace-pre-wrap break-all leading-relaxed max-h-44 overflow-y-auto custom-scrollbar">
                    {tool.args.content.slice(0, 1500)}
                    {tool.args.content.length > 1500 ? '\n…（内容已截断，完整内容请谨慎评估后决定）' : ''}
                  </pre>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={approvingToolId === tool.approvalId}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDecision(tool.approvalId!, 'deny', tool.id);
                  }}
                  className="px-3 py-1.5 rounded-xl border border-rose-200 bg-white hover:bg-rose-50 text-rose-600 hover:text-rose-700 text-xs font-medium transition-colors cursor-pointer flex items-center gap-1 disabled:opacity-50"
                >
                  <XCircle size={13} />
                  <span>拒绝执行</span>
                </button>
                <button
                  type="button"
                  disabled={approvingToolId === tool.approvalId}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDecision(tool.approvalId!, 'approve', tool.id);
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {approvingToolId === tool.approvalId ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>处理中...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle size={13} />
                      <span>批准执行</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Denied Banner */}
          {tool.status === 'denied' && (
            <div className="p-2.5 bg-rose-50/80 border border-rose-200/80 rounded-xl flex items-center gap-2 text-rose-800 text-[11px]">
              <XCircle size={14} className="text-rose-600 flex-shrink-0" />
              <span>该工具调用已被人工拒绝，AI 无法执行此敏感操作并已获知拒绝状态。</span>
            </div>
          )}

          {/* Parameters / Target */}
          {tool.preview && (
            <div className="space-y-1">
              <div className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5">
                <Code size={11} className="text-slate-400" />
                <span>调用参数与目标</span>
              </div>
              <div className="bg-white border border-black/[0.06] rounded-xl p-2.5 font-mono text-[11px] text-slate-700 whitespace-pre-wrap break-all leading-relaxed max-h-24 overflow-y-auto shadow-2xs">
                {tool.preview}
              </div>
            </div>
          )}

          {/* Result / Output Console */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
              <span className="flex items-center gap-1.5">
                <Terminal size={11} className="text-emerald-600" />
                <span>执行结果与输出</span>
              </span>
              {tool.result && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopyResult(tool.result!);
                  }}
                  className="px-2 py-0.5 rounded-md bg-white border border-black/[0.08] hover:bg-slate-100 text-slate-600 text-[10px] transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                  title="复制结果"
                >
                  {copiedToolResult ? (
                    <>
                      <CheckCircle size={10} className="text-emerald-600" />
                      <span className="text-emerald-600 font-bold">已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy size={10} />
                      <span>复制</span>
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="bg-slate-50 rounded-xl p-3 border border-black/[0.06] font-mono text-xs max-h-60 overflow-y-auto text-slate-800">
              {tool.result ? (
                <div className="leading-relaxed whitespace-pre-wrap break-all text-[11px] text-slate-700">
                  {tool.result}
                </div>
              ) : tool.status === 'waiting_approval' ? (
                <div className="flex items-center justify-center py-5 gap-2 text-amber-600 text-xs font-medium">
                  <ShieldAlert size={14} className="text-amber-500 animate-pulse" />
                  <span>等待人工审批确认中，批准后将继续执行...</span>
                </div>
              ) : tool.status === 'running' ? (
                <div className="flex items-center justify-center py-6 gap-2 text-slate-400 text-xs">
                  <Loader2 size={14} className="animate-spin text-indigo-500" />
                  <span>正在执行中，等待输出返回...</span>
                </div>
              ) : (
                <div className="text-slate-400 text-center py-4 text-xs">
                  该工具调用已执行完成，无控制台回显内容。
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
