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
import { cn } from '@/lib/client/utils';
import { ToolInvocation } from '../../types';

interface ToolCardProps {
  tool: ToolInvocation;
  isExpanded: boolean;
  onToggleExpand: (toolId: string) => void;
  copiedToolResult: boolean;
  onCopyResult: (text: string) => void;
  timestamp?: number;
}

export const ToolCard: React.FC<ToolCardProps> = ({
  tool,
  isExpanded,
  onToggleExpand,
  copiedToolResult,
  onCopyResult,
  timestamp,
}) => {
  const liveConsoleRef = React.useRef<HTMLDivElement | null>(null);

  // 实时输出滚动跟随
  React.useEffect(() => {
    const el = liveConsoleRef.current;
    if (el && tool.liveOutput) el.scrollTop = el.scrollHeight;
  }, [tool.liveOutput]);

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
          {timestamp ? (
            <span
              className="text-[10px] text-slate-400 font-mono hidden xs:inline"
              title={new Date(timestamp).toLocaleString('zh-CN')}
            >
              {new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}
            </span>
          ) : null}
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
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
                <span className="flex items-center gap-1.5">
                  <Code size={11} className="text-slate-400" />
                  <span>调用参数与目标</span>
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopyResult(tool.preview);
                  }}
                  className="px-2 py-0.5 rounded-md bg-white border border-black/[0.08] hover:bg-slate-100 text-slate-600 text-[10px] transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                  title="复制参数"
                >
                  <Copy size={10} />
                  <span>复制</span>
                </button>
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
              {(tool.result || tool.liveOutput) && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopyResult(tool.result || tool.liveOutput || '');
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

            <div
              ref={liveConsoleRef}
              className="bg-slate-50 rounded-xl p-3 border border-black/[0.06] font-mono text-xs max-h-60 overflow-y-auto text-slate-800"
            >
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
                tool.liveOutput ? (
                  <div className="leading-relaxed whitespace-pre-wrap break-all text-[11px] text-slate-700">
                    {tool.liveOutput}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-6 gap-2 text-slate-400 text-xs">
                    <Loader2 size={14} className="animate-spin text-indigo-500" />
                    <span>正在执行中，等待输出返回...</span>
                  </div>
                )
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
