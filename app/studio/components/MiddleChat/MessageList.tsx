import React from 'react';
import { Loader2, LayoutGrid } from 'lucide-react';
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
}

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
}) => {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
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

        {messages.map((message, index) => {
          if (message.role === 'user') {
            return (
              <div key={message.id} className="flex justify-end">
                <div className="bg-slate-950 text-white px-4 py-2.5 rounded-2xl max-w-[82%] text-sm leading-relaxed shadow-sm font-medium">
                  {message.content}
                </div>
              </div>
            );
          }

          return (
            <div key={message.id} className="space-y-3">
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
                    />
                  ))}
                </div>
              )}

              {/* Assistant Bubble Frame */}
              {message.content && (
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-2xl bg-white border border-black/[0.06] shadow-xs flex items-center justify-center text-sm flex-shrink-0 mt-0.5">
                    🤖
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="bg-white border border-black/[0.06] rounded-[24px] px-5 py-4 shadow-sm text-sm text-slate-800 leading-relaxed max-w-full">
                      <div className="markdown-body text-slate-800">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            code({ inline, className, children, ...props }: any) {
                              return inline ? (
                                <code
                                  className="bg-slate-100 text-indigo-600 font-mono text-xs px-1.5 py-0.5 rounded"
                                  {...props}
                                >
                                  {children}
                                </code>
                              ) : (
                                <pre className="my-2 rounded-xl bg-slate-50 border border-black/[0.06] p-3 text-slate-800 font-mono text-xs overflow-x-auto">
                                  <code {...props}>{children}</code>
                                </pre>
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
                        {isStreaming && index === messages.length - 1 && (
                          <span className="inline-block w-1.5 h-3.5 bg-indigo-600 ml-0.5 animate-pulse align-middle" />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};
