import React from 'react';
import {
  Plus,
  Brain,
  ChevronDown,
  Shield,
  Mic,
  Send,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StudioApprovalMode } from '../../types';

interface ComposerProps {
  totalTokens: number;
  contextLength: number;
  remainingTokens: number;
  usagePercent: number;
  formatTokens: (tokens: number) => string;
  input: string;
  setInput: (v: string) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  isStreaming: boolean;
  handleOpenFileExplorer: () => void;
  reasoningEffort: 'none' | 'low' | 'medium' | 'high';
  setReasoningEffort: (lvl: 'none' | 'low' | 'medium' | 'high') => void;
  showReasoningMenu: boolean;
  setShowReasoningMenu: (v: boolean) => void;
  approvalMode: StudioApprovalMode;
  handleSelectApprovalMode: (mode: StudioApprovalMode) => void;
  showApprovalMenu: boolean;
  setShowApprovalMenu: (v: boolean) => void;
  userProfile: any;
  setShowSettingsModal: (v: boolean) => void;
  isListening: boolean;
  handleToggleVoice: () => void;
  handleSend: () => void;
}

export const Composer: React.FC<ComposerProps> = ({
  totalTokens,
  contextLength,
  remainingTokens,
  usagePercent,
  formatTokens,
  input,
  setInput,
  handleKeyDown,
  textareaRef,
  isStreaming,
  handleOpenFileExplorer,
  reasoningEffort,
  setReasoningEffort,
  showReasoningMenu,
  setShowReasoningMenu,
  approvalMode,
  handleSelectApprovalMode,
  showApprovalMenu,
  setShowApprovalMenu,
  userProfile,
  setShowSettingsModal,
  isListening,
  handleToggleVoice,
  handleSend,
}) => {
  return (
    <div className="max-w-3xl mx-auto bg-white border border-black/[0.08] rounded-3xl p-3 shadow-lg transition-all duration-200 focus-within:border-black/[0.2] focus-within:ring-4 focus-within:ring-slate-100">
      {/* Token Usage Header Row */}
      <div className="flex items-center justify-between text-[10px] sm:text-[11px] font-mono text-slate-400 mb-2 px-1">
        <div className="flex items-center gap-1.5 sm:gap-2 truncate">
          <span>
            {totalTokens === 0 ? '0' : formatTokens(totalTokens)} / {formatTokens(contextLength)}
          </span>
          <span className="hidden xs:inline">·</span>
          <span className="hidden xs:inline">
            {totalTokens === 0
              ? `剩余 ${formatTokens(contextLength)} (就绪)`
              : `剩余 ${formatTokens(remainingTokens)}`}
          </span>
          {totalTokens > 0 && (
            <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded font-sans hidden sm:inline border border-emerald-200">
              模型实际返回
            </span>
          )}
        </div>

        {/* Context progress bar */}
        <div className="w-16 sm:w-24 h-1.5 rounded-full bg-slate-100 overflow-hidden flex-shrink-0">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              usagePercent > 80
                ? 'bg-rose-500'
                : usagePercent > 60
                ? 'bg-amber-500'
                : 'bg-indigo-500'
            )}
            style={{ width: `${Math.max(4, usagePercent)}%` }}
          />
        </div>
      </div>

      {/* Textarea Input */}
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入你的工程任务或规划需求... (Enter 发送, Shift+Enter 换行)"
        rows={2}
        className="w-full bg-transparent border-0 text-sm text-slate-800 placeholder-slate-400 focus:outline-none resize-none leading-relaxed px-1"
      />

      {/* Bottom Toolbar Controls */}
      <div className="flex items-center justify-between pt-2 mt-1 border-t border-black/[0.04] text-xs gap-1.5 flex-wrap sm:flex-nowrap">
        <div className="flex items-center gap-1 sm:gap-2 min-w-0 flex-wrap sm:flex-nowrap">
          {/* Attach Button */}
          <button
            type="button"
            onClick={handleOpenFileExplorer}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer flex-shrink-0"
            title="选择工作区文件作为上下文"
          >
            <Plus size={16} />
          </button>

          {/* Reasoning Effort (Thinking Level) */}
          <div className="relative flex-shrink-0 z-30">
            <button
              type="button"
              onClick={() => {
                setShowReasoningMenu(!showReasoningMenu);
                setShowApprovalMenu(false);
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer font-medium"
            >
              <Brain size={14} className="text-slate-400" />
              <span className="capitalize">
                {reasoningEffort === 'none'
                  ? '关闭思考'
                  : reasoningEffort === 'low'
                  ? '低思考'
                  : reasoningEffort === 'medium'
                  ? '中思考'
                  : '高思考'}
              </span>
              <ChevronDown size={11} className="text-slate-400" />
            </button>

            {showReasoningMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowReasoningMenu(false)}
                />
                <div className="absolute left-0 bottom-full mb-2 w-32 rounded-2xl bg-white border border-black/[0.08] p-1.5 shadow-2xl z-50 text-xs space-y-0.5 animate-fadeIn">
                  {(['none', 'low', 'medium', 'high'] as const).map((lvl) => (
                    <button
                      key={lvl}
                      onClick={() => {
                        setReasoningEffort(lvl);
                        setShowReasoningMenu(false);
                      }}
                      className={cn(
                        'w-full text-left px-2.5 py-1.5 rounded-xl transition-colors font-medium cursor-pointer',
                        reasoningEffort === lvl
                          ? 'bg-indigo-50 text-indigo-700 font-bold'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      )}
                    >
                      {lvl === 'none'
                        ? '关闭思考'
                        : lvl === 'low'
                        ? '低思考'
                        : lvl === 'medium'
                        ? '中思考'
                        : '高思考'}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Approval Mode Dropdown */}
          <div className="relative flex-shrink-0 z-30">
            <button
              type="button"
              onClick={() => {
                setShowApprovalMenu(!showApprovalMenu);
                setShowReasoningMenu(false);
              }}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors cursor-pointer font-medium',
                approvalMode === 'dangerous'
                  ? 'text-amber-700 bg-amber-50/80 hover:bg-amber-100/80 border border-amber-200/60'
                  : approvalMode === 'always'
                  ? 'text-indigo-700 bg-indigo-50/80 hover:bg-indigo-100/80 border border-indigo-200/60'
                  : 'text-slate-600 hover:bg-slate-100'
              )}
              title="工具调用人机审批模式"
            >
              <Shield
                size={13}
                className={
                  approvalMode === 'dangerous'
                    ? 'text-amber-600'
                    : approvalMode === 'always'
                    ? 'text-indigo-600'
                    : 'text-slate-400'
                }
              />
              <span>
                {approvalMode === 'dangerous'
                  ? '高危审批'
                  : approvalMode === 'always'
                  ? '全量审批'
                  : '自动放行'}
              </span>
              <ChevronDown size={11} className="text-slate-400" />
            </button>

            {showApprovalMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowApprovalMenu(false)}
                />
                <div className="absolute left-0 bottom-full mb-2 w-52 rounded-2xl bg-white border border-black/[0.08] p-1.5 shadow-2xl z-50 text-xs space-y-0.5 animate-fadeIn">
                  <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    工具人机审批模式
                  </div>
                  {[
                    { key: 'dangerous', label: '🛡️ 仅高危工具审批', desc: '写文件与执行委派前需确认 (推荐)' },
                    { key: 'always', label: '🔒 全量操作审批', desc: '所有工具（含读文件/扫描）均需确认' },
                    { key: 'never', label: '⚡ 自动放行执行', desc: '完全信任模型，自主执行所有工具' },
                  ].map((item) => (
                    <button
                      key={item.key}
                      onClick={() => handleSelectApprovalMode(item.key as any)}
                      className={cn(
                        'w-full text-left px-2.5 py-1.5 rounded-xl transition-colors font-medium cursor-pointer',
                        approvalMode === item.key
                          ? 'bg-amber-50 text-amber-900 font-bold'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      )}
                    >
                      <div className="text-xs">{item.label}</div>
                      <div className="text-[10px] text-slate-400 font-normal leading-tight mt-0.5">
                        {item.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Account Active Model Indicator */}
          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200/80 border border-black/[0.06] text-slate-700 transition-colors cursor-pointer group shadow-2xs flex-shrink-0 max-w-[120px] sm:max-w-none"
            title="已自动直连您的登录账号模型配置，点击查看环境与凭据状态"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
            <span className="font-mono text-xs font-bold text-slate-800 tracking-tight truncate">
              {userProfile?.modelName || '默认模型'}
            </span>
            <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1 py-0.2 rounded font-sans ml-0.5 hidden sm:inline border border-emerald-200">
              账号模型
            </span>
          </button>
        </div>

        {/* Right: Mic & Send Button */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 ml-auto sm:ml-0">
          <button
            type="button"
            onClick={handleToggleVoice}
            className={cn(
              'p-1.5 transition-all cursor-pointer rounded-lg flex items-center justify-center',
              isListening
                ? 'text-rose-600 bg-rose-50 animate-pulse ring-1 ring-rose-400'
                : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
            )}
            title={isListening ? '正在录音识别中，点击停止' : '语音输入 (点击开始讲话)'}
          >
            <Mic size={16} className={cn(isListening && 'text-rose-600')} />
          </button>

          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-xs',
              input.trim()
                ? 'bg-slate-950 text-white hover:bg-slate-800'
                : 'bg-slate-200 text-slate-400'
            )}
          >
            <Send size={13} className="translate-x-0.2" />
          </button>
        </div>
      </div>
    </div>
  );
};
