import React, { useState } from 'react';
import {
  Loader2,
  LayoutGrid,
  Copy,
  Check,
  Trash2,
  RotateCw,
  Zap,
  ArrowUp,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatMessage } from '../../types';
import { ToolCard } from './ToolCard';

interface MessageListProps {
  messages: ChatMessage[];
  isLoadingMessages: boolean;
  activeWorkspaceName: string;
  onQuickPrompt: (prompt: string) => void;
  expandedToolIds: Set<string>;
  toggleToolExpand: (toolId: string) => void;
  approvingToolId: string | null;
  handleDecisionTool: (approvalId: string, action: 'approve' | 'deny', toolId: string) => void;
  copiedToolResult: boolean;
  handleCopyToolResult: (result: string) => void;
  isStreaming: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  onDeleteMessage?: (messageId: string) => void;
  onRetryMessage?: (assistantMessageId: string) => void;
  hasMoreMessages?: boolean;
  isLoadingMoreMessages?: boolean;
  onLoadMoreMessages?: () => void;
}

const formatTime = (ts?: number) => {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
};

const formatFullDateTime = (ts?: number) => {
  if (!ts) return '';
  return new Date(ts).toLocaleString('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const formatTokenBadge = (tokens?: number | null) => {
  if (!tokens) return null;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
};

const MarkdownCodeBlock: React.FC<{ className?: string; children: React.ReactNode }> = React.memo(({
  className,
  children,
}) => {
  const [copied, setCopied] = useState(false);
  const lang = (className || '').replace('language-', '').trim();
  const rawText = String(children).replace(/\n$/, '');

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(rawText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-2.5 rounded-xl border border-black/[0.08] overflow-hidden bg-slate-50 shadow-2xs group/code">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-100/80 border-b border-black/[0.06] text-[10px] font-mono text-slate-500 select-none">
        <span className="font-semibold text-slate-600">{lang || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-slate-800 transition-colors cursor-pointer text-slate-500"
          title="复制代码块"
        >
          {copied ? (
            <>
              <Check size={11} className="text-emerald-600" />
              <span className="text-emerald-600 font-sans font-medium">已复制</span>
            </>
          ) : (
            <>
              <Copy size={11} />
              <span className="font-sans">复制</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3 text-slate-800 font-mono text-xs overflow-x-auto leading-relaxed bg-slate-50">
        <code>{children}</code>
      </pre>
    </div>
  );
});

MarkdownCodeBlock.displayName = 'MarkdownCodeBlock';

interface MessageItemProps {
  message: ChatMessage;
  isLastAssistant: boolean;
  isStreaming: boolean;
  expandedToolIds: Set<string>;
  toggleToolExpand: (toolId: string) => void;
  approvingToolId: string | null;
  handleDecisionTool: (approvalId: string, action: 'approve' | 'deny', toolId: string) => void;
  copiedToolResult: boolean;
  handleCopyToolResult: (result: string) => void;
  onDeleteMessage?: (messageId: string) => void;
  onRetryMessage?: (assistantMessageId: string) => void;
  isCopied: boolean;
  onCopyMessage: (id: string, text: string) => void;
}

const MessageItem = React.memo<MessageItemProps>(
  ({
    message,
    isLastAssistant,
    isStreaming,
    expandedToolIds,
    toggleToolExpand,
    approvingToolId,
    handleDecisionTool,
    copiedToolResult,
    handleCopyToolResult,
    onDeleteMessage,
    onRetryMessage,
    isCopied,
    onCopyMessage,
  }) => {
    if (message.role === 'user') {
      return (
        <div className="group flex flex-col items-end gap-1">
          <div className="bg-slate-950 text-white px-4 py-2.5 rounded-2xl max-w-[85%] text-sm leading-relaxed shadow-sm font-medium whitespace-pre-wrap break-words">
            {message.content}
          </div>

          {/* User Message Action Bar */}
          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono opacity-90 sm:opacity-0 group-hover:opacity-100 transition-opacity pr-1">
            {message.timestamp ? (
              <span title={formatFullDateTime(message.timestamp)} className="text-slate-400 select-none">
                {formatTime(message.timestamp)}
              </span>
            ) : null}

            <button
              type="button"
              onClick={() => onCopyMessage(message.id, message.content || '')}
              className="hover:text-slate-700 transition-colors p-1 rounded hover:bg-slate-100 cursor-pointer flex items-center gap-1"
              title="复制提问"
            >
              {isCopied ? (
                <>
                  <Check size={11} className="text-emerald-600" />
                  <span className="text-[10px] text-emerald-600 font-sans">已复制</span>
                </>
              ) : (
                <Copy size={11} />
              )}
            </button>

            {onDeleteMessage && (
              <button
                type="button"
                onClick={() => onDeleteMessage(message.id)}
                className="hover:text-rose-600 transition-colors p-1 rounded hover:bg-rose-50 cursor-pointer flex items-center gap-1 text-slate-400"
                title="删除该条提问"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {/* Embedded Tool Calls */}
        {message.tools && message.tools.length > 0 && (
          <div className="space-y-2.5 my-2">
            {message.tools.map((tool) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                isExpanded={expandedToolIds.has(tool.id)}
                onToggleExpand={toggleToolExpand}
                approvingToolId={approvingToolId}
                onDecision={handleDecisionTool}
                copiedToolResult={copiedToolResult}
                onCopyResult={handleCopyToolResult}
                timestamp={message.timestamp}
              />
            ))}
          </div>
        )}

        {/* Assistant Bubble Frame */}
        {message.content && (
          <div className="group flex items-start gap-3">
            <div className="w-8 h-8 rounded-2xl bg-white border border-black/[0.06] shadow-xs flex items-center justify-center text-sm flex-shrink-0 mt-0.5 select-none">
              🤖
            </div>
            <div className="flex-1 min-w-0">
              <div className="bg-white border border-black/[0.06] rounded-[24px] px-5 py-4 shadow-sm text-sm text-slate-800 leading-relaxed max-w-full">
                <div className="markdown-body text-slate-800">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      pre({ children }: any) {
                        return <>{children}</>;
                      },
                      code({ inline, className, children, ...props }: any) {
                        return inline ? (
                          <code
                            className="bg-slate-100 text-indigo-600 font-mono text-xs px-1.5 py-0.5 rounded"
                            {...props}
                          >
                            {children}
                          </code>
                        ) : (
                          <MarkdownCodeBlock className={className}>
                            {children}
                          </MarkdownCodeBlock>
                        );
                      },
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:text-indigo-700 underline underline-offset-2 font-medium"
                        >
                          {children}
                        </a>
                      ),
                      table: ({ children }) => (
                        <div className="overflow-x-auto my-3">
                          <table className="min-w-full divide-y divide-slate-200 border border-slate-200 text-xs">
                            {children}
                          </table>
                        </div>
                      ),
                      th: ({ children }) => (
                        <th className="bg-slate-50 px-3 py-2 text-left font-bold text-slate-800 border-b border-slate-200">
                          {children}
                        </th>
                      ),
                      td: ({ children }) => (
                        <td className="px-3 py-1.5 border-b border-slate-100 text-slate-700">
                          {children}
                        </td>
                      ),
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                  {isStreaming && isLastAssistant && (
                    <span className="inline-block w-1.5 h-3.5 bg-indigo-600 ml-0.5 animate-pulse align-middle" />
                  )}
                </div>
              </div>

              {/* Assistant Message Action & Meta Bar */}
              <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono mt-1.5 px-2 flex-wrap select-none">
                {message.timestamp ? (
                  <span title={formatFullDateTime(message.timestamp)} className="text-slate-400">
                    {formatTime(message.timestamp)}
                  </span>
                ) : null}

                {/* Single Message Token Usage Badge */}
                {message.tokens ? (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500 bg-slate-100/90 hover:bg-slate-200/80 px-1.5 py-0.5 rounded-md transition-colors cursor-default"
                    title={`本轮对话模型实际消耗: ${message.tokens.toLocaleString()} Tokens`}
                  >
                    <Zap size={10} className="text-amber-500" />
                    <span>{formatTokenBadge(message.tokens)} tokens</span>
                  </span>
                ) : null}

                {/* Action buttons (hover on desktop or subtle on mobile) */}
                <div className="flex items-center gap-1.5 opacity-90 sm:opacity-0 group-hover:opacity-100 transition-opacity ml-auto sm:ml-1">
                  <button
                    type="button"
                    onClick={() => onCopyMessage(message.id, message.content || '')}
                    className="hover:text-slate-700 transition-colors p-1 rounded hover:bg-slate-100 cursor-pointer flex items-center gap-1 text-slate-400"
                    title="复制回复全文"
                  >
                    {isCopied ? (
                      <>
                        <Check size={11} className="text-emerald-600" />
                        <span className="text-[10px] text-emerald-600 font-sans">已复制</span>
                      </>
                    ) : (
                      <>
                        <Copy size={11} />
                        <span className="text-[10px] hidden xs:inline font-sans">复制</span>
                      </>
                    )}
                  </button>

                  {/* Retry / Regenerate (Only on the latest assistant message) */}
                  {isLastAssistant && !isStreaming && onRetryMessage && (
                    <button
                      type="button"
                      onClick={() => onRetryMessage(message.id)}
                      className="hover:text-indigo-600 transition-colors p-1 rounded hover:bg-indigo-50 cursor-pointer flex items-center gap-1 text-slate-400"
                      title="重新生成此条回答"
                    >
                      <RotateCw size={11} />
                      <span className="text-[10px] hidden xs:inline font-sans">重新生成</span>
                    </button>
                  )}

                  {onDeleteMessage && !isStreaming && (
                    <button
                      type="button"
                      onClick={() => onDeleteMessage(message.id)}
                      className="hover:text-rose-600 transition-colors p-1 rounded hover:bg-rose-50 cursor-pointer flex items-center gap-1 text-slate-400"
                      title="删除该条回复"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
  (prev, next) => {
    // Return true to skip re-render, false to re-render
    if (prev.message !== next.message) {
      if (
        prev.message.id !== next.message.id ||
        prev.message.content !== next.message.content ||
        prev.message.tokens !== next.message.tokens ||
        prev.message.tools !== next.message.tools
      ) {
        return false;
      }
    }
    if (prev.isLastAssistant !== next.isLastAssistant) return false;
    if (next.isLastAssistant && prev.isStreaming !== next.isStreaming) return false;
    if (prev.isCopied !== next.isCopied) return false;

    // Check tools if message has tools
    if (next.message.tools && next.message.tools.length > 0) {
      if (prev.approvingToolId !== next.approvingToolId) return false;
      if (prev.copiedToolResult !== next.copiedToolResult) return false;
      for (const t of next.message.tools) {
        if (prev.expandedToolIds.has(t.id) !== next.expandedToolIds.has(t.id)) {
          return false;
        }
      }
    }

    return true;
  }
);

MessageItem.displayName = 'MessageItem';

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  isLoadingMessages,
  activeWorkspaceName,
  onQuickPrompt,
  expandedToolIds,
  toggleToolExpand,
  approvingToolId,
  handleDecisionTool,
  copiedToolResult,
  handleCopyToolResult,
  isStreaming,
  messagesEndRef,
  scrollContainerRef,
  onDeleteMessage,
  onRetryMessage,
  hasMoreMessages,
  isLoadingMoreMessages,
  onLoadMoreMessages,
}) => {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const handleCopyMessage = async (id: string, text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(id);
      setTimeout(() => {
        setCopiedMessageId((prev) => (prev === id ? null : prev));
      }, 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  // Auto-trigger load more when user scrolls near the top
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!hasMoreMessages || isLoadingMoreMessages || !onLoadMoreMessages) return;
    if (e.currentTarget.scrollTop < 60) {
      onLoadMoreMessages();
    }
  };

  // Find index of the very last assistant message
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      lastAssistantIndex = i;
      break;
    }
  }

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 py-6"
    >
      <div className="max-w-3xl mx-auto space-y-6">
        {isLoadingMessages ? (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
            <Loader2 size={24} className="text-indigo-600 animate-spin" />
            <div className="text-xs text-slate-500 font-mono">
              正在从数据库加载工作区【{activeWorkspaceName}】历史对话记录...
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-5">
            <div className="w-14 h-14 rounded-2xl bg-white border border-black/[0.06] flex items-center justify-center shadow-md">
              <LayoutGrid size={28} className="text-indigo-600" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-base font-black text-slate-900">协调智能体团队已就绪</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                总指挥官能自动感知沙箱工作区文件，拆解任务架构，并实时调度内置 Pi 等专业 Agent 协同编写与测试。
              </p>
            </div>

            {/* Quick Prompt Cards */}
            <div className="grid grid-cols-2 gap-3 w-full max-w-md text-left pt-2">
              {[
                {
                  title: '扫描当前项目结构',
                  desc: '感知工作区根目录与关键配置文件',
                  cmd: '请帮我扫描当前工作区目录结构并汇报。',
                },
                {
                  title: '调度 Pi 编写工具脚本',
                  desc: '在沙箱中由 Pi 编写并运行统计脚本',
                  cmd: '请让内置 Pi 智能体编写一个递归统计代码行数的脚本，输出到工作区。',
                },
              ].map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => onQuickPrompt(item.cmd)}
                  className="p-3 rounded-2xl bg-white/80 border border-black/[0.06] hover:border-black/[0.12] hover:bg-white text-left transition-all cursor-pointer group shadow-xs hover:shadow-sm"
                >
                  <div className="text-xs font-bold text-slate-800 group-hover:text-indigo-600 transition-colors">
                    {item.title}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 leading-snug">{item.desc}</div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Load more older messages trigger */}
        {hasMoreMessages && (
          <div className="flex justify-center pb-2 pt-1">
            <button
              type="button"
              onClick={onLoadMoreMessages}
              disabled={isLoadingMoreMessages}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-black/[0.08] bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 text-xs font-medium shadow-2xs transition-all cursor-pointer disabled:opacity-60 group select-none"
            >
              {isLoadingMoreMessages ? (
                <>
                  <Loader2 size={13} className="animate-spin text-indigo-600" />
                  <span className="text-[11px] text-indigo-600 font-mono">正在加载更早的历史记录...</span>
                </>
              ) : (
                <>
                  <ArrowUp size={12} className="text-slate-400 group-hover:text-indigo-600 transition-colors" />
                  <span className="text-[11px]">查看更早的历史对话</span>
                </>
              )}
            </button>
          </div>
        )}

        {messages.map((message, index) => (
          <MessageItem
            key={message.id}
            message={message}
            isLastAssistant={index === lastAssistantIndex}
            isStreaming={isStreaming}
            expandedToolIds={expandedToolIds}
            toggleToolExpand={toggleToolExpand}
            approvingToolId={approvingToolId}
            handleDecisionTool={handleDecisionTool}
            copiedToolResult={copiedToolResult}
            handleCopyToolResult={handleCopyToolResult}
            onDeleteMessage={onDeleteMessage}
            onRetryMessage={onRetryMessage}
            isCopied={copiedMessageId === message.id}
            onCopyMessage={handleCopyMessage}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};

