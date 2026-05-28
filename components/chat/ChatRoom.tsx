'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Check, ChevronDown, ChevronUp, Copy, RefreshCw, Send, Sparkles, Square } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import Avatar from '@/components/shared/Avatar';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { getBuiltInAgents } from '@/lib/agents-data';
import { streamChat, conversations as conversationsApi, agents as agentsApi, user as userApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CATEGORY_COLORS } from '@/types';
import type { Agent } from '@/types';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

type DisplayAgent = {
  id: string;
  name: string;
  avatar?: string;
  description?: string;
  category?: string;
  tone?: string;
  greeting?: string;
  systemPrompt?: string;
};

const promptMap: Record<string, string[]> = {
  写作: ['帮我把这段话改得更有吸引力', '生成 5 个标题', '把内容改成小红书风格'],
  编程: ['帮我定位这个报错', '解释这段代码的思路', '给我一个更简单的实现'],
  学习: ['用简单例子讲清楚这个概念', '帮我总结重点', '出 3 道练习题'],
  心理: ['我最近有点焦虑，帮我梳理一下', '陪我做一次放松练习', '帮我分析这个选择'],
  创意: ['给我 10 个新点子', '帮我扩展这个设定', '换一个更有趣的方向'],
  生活: ['帮我规划一周安排', '给我一个实用清单', '帮我比较几个选择'],
  工具: ['帮我整理成表格', '提炼成待办事项', '把内容压缩成摘要'],
  娱乐: ['来一个轻松的话题', '推荐点有趣的内容', '我们玩个小游戏'],
};

interface ChatRoomProps {
  agentId?: string;
  conversationId?: string;
}

export default function ChatRoom({ agentId: routeAgentId, conversationId: routeConversationId }: ChatRoomProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const agentId = routeAgentId || '';
  const initialPrompt = searchParams.get('prompt');
  const existingConversationId = routeConversationId || searchParams.get('conversationId');

  const [agent, setAgent] = useState<Agent | null>(null);
  const [conversationAgent, setConversationAgent] = useState<DisplayAgent | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [userSettings, setUserSettings] = useState<{ apiBaseUrl?: string; apiKey?: string; modelName?: string } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const loadAgent = async () => {
      try {
        // Try API first, fall back to built-in
        let found: Agent | undefined;
        if (agentId) {
          try {
            const result = await agentsApi.get(agentId);
            found = result.agent;
          } catch {
            const builtIn = await getBuiltInAgents();
            found = builtIn.find((item) => item.id === agentId);
          }
        }

        setAgent(found || null);

        // Load user settings for model config
        try {
          const { user: u } = await userApi.get();
          if (u.customModelEnabled && u.apiBaseUrl && u.apiKey && u.modelName) {
            setUserSettings({ apiBaseUrl: u.apiBaseUrl, apiKey: u.apiKey, modelName: u.modelName });
          }
        } catch {
          // Not logged in or failed, use defaults
        }

        // Load existing conversation snapshot and messages
        if (existingConversationId) {
          setConversationId(existingConversationId);
          try {
            const { conversation } = await conversationsApi.get(existingConversationId);
            setConversationAgent({
              id: conversation.agentId || agentId || existingConversationId,
              name: conversation.agentName || found?.name || '未知 Agent',
              avatar: conversation.agentAvatar || found?.avatar,
              description: conversation.agentDescription || found?.description,
              category: conversation.agentCategory || found?.category,
              tone: conversation.agentTone || found?.tone,
              systemPrompt: conversation.agentSystemPrompt || found?.systemPrompt,
              greeting: found?.greeting,
            });

            const { messages: existingMessages } = await conversationsApi.getMessages(existingConversationId);
            setMessages(
              existingMessages.map((msg: any) => ({
                id: msg.id,
                role: msg.role,
                content: msg.content,
                createdAt: msg.createdAt,
              }))
            );
          } catch {
            // Failed to load messages, start fresh
          }
        } else if (found?.greeting) {
          setMessages([
            {
              id: 'greeting',
              role: 'assistant',
              content: found.greeting,
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      } finally {
        setLoading(false);
      }
    };

    loadAgent();
  }, [agentId, existingConversationId]);

  useEffect(() => {
    if (initialPrompt && agent && messages.length <= 1 && !existingConversationId) {
      handleSend(initialPrompt);
    }
  }, [initialPrompt, agent, existingConversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const displayAgent = conversationAgent || agent;
  const categoryColor = displayAgent ? CATEGORY_COLORS[displayAgent.category || ''] || '#6366f1' : '#6366f1';
  const suggestedPrompts = useMemo(() => {
    if (!displayAgent) return ['你能帮我做什么？', '给我介绍一下你的能力', '我们从一个小任务开始'];
    return promptMap[displayAgent.category || ''] || ['你能帮我做什么？', '给我介绍一下你的能力', '我们从一个小任务开始'];
  }, [displayAgent]);

  const handleSend = async (text?: string) => {
    const content = text || input.trim();
    if (!content || isStreaming) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsStreaming(true);
    setStreamingContent('');

    try {
      const history = messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));

      const controller = new AbortController();
      abortRef.current = controller;

      const result = await streamChat({
        message: content,
        history,
        context: displayAgent?.systemPrompt,
        conversationId: conversationId || undefined,
        agentId: displayAgent?.id || agentId,
        agentSnapshot: displayAgent
          ? {
              name: displayAgent.name,
              avatar: displayAgent.avatar,
              category: displayAgent.category,
              tone: displayAgent.tone,
              description: displayAgent.description,
              systemPrompt: displayAgent.systemPrompt,
            }
          : undefined,
        ...(userSettings || {}),
        signal: controller.signal,
      });

      if (result.conversationId && !conversationId) {
        setConversationId(result.conversationId);
      }

      const reader = result.stream.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullContent += chunk;
        setStreamingContent(fullContent);
      }

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: fullContent,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setStreamingContent('');
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Chat error:', error);
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: '抱歉，刚才生成失败了。你可以稍后再试，或换一种问法。',
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    } finally {
      setIsStreaming(false);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    if (streamingContent) {
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: streamingContent,
          createdAt: new Date().toISOString(),
        },
      ]);
      setStreamingContent('');
    }
  };

  const handleRegenerate = () => {
    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    if (!lastUserMessage || isStreaming) return;
    setMessages((prev) => prev.filter((message) => message.id !== prev[prev.length - 1]?.id));
    handleSend(lastUserMessage.content);
  };

  const handleCopy = (id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#fbfaf7]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!displayAgent) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-[#fbfaf7]">
        <p className="font-semibold text-slate-500">Agent 不存在</p>
        <button
          onClick={() => router.push('/')}
          className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-bold text-white"
        >
          返回发现页
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#fbfaf7] text-slate-950">
      <aside className="hidden w-[340px] shrink-0 border-r border-black/[0.06] bg-white/80 p-5 backdrop-blur lg:flex lg:flex-col">
        <button
          onClick={() => router.back()}
          className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-black/[0.06] bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm hover:text-slate-950"
        >
          <ArrowLeft size={16} />
          返回
        </button>

        <div className="overflow-hidden rounded-[32px] border border-black/[0.06] bg-[#fbfaf7] shadow-sm">
          <div className="h-2" style={{ backgroundColor: categoryColor }} />
          <div className="p-5 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[24px] bg-white shadow-sm">
              <Avatar src={displayAgent.avatar} alt={displayAgent.name} size="lg" />
            </div>
            <h1 className="mt-3 line-clamp-2 text-xl font-black leading-tight text-slate-950">{displayAgent.name}</h1>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <span className="rounded-full px-2.5 py-1 text-xs font-bold text-white" style={{ backgroundColor: categoryColor }}>
                {displayAgent.category || 'Agent'}
              </span>
              {displayAgent.tone && (
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-600">
                  {displayAgent.tone}
                </span>
              )}
            </div>
            <p className="mx-auto mt-3 line-clamp-2 max-w-[240px] text-sm leading-6 text-slate-600">
              {displayAgent.description}
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-[28px] border border-black/[0.06] bg-white p-5 shadow-sm">
          <button
            onClick={() => setDetailsOpen((value) => !value)}
            className="flex w-full items-center justify-between text-left"
          >
            <div>
              <h2 className="text-lg font-black text-slate-950">Agent 详情</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                查看它的开场白、行为设定和适用场景。
              </p>
            </div>
            <div className="rounded-full bg-[#fbfaf7] p-2 text-slate-500">
              {detailsOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </div>
          </button>

          {detailsOpen && (
            <div className="mt-5 max-h-[calc(100vh-430px)] min-h-0 space-y-4 overflow-y-auto border-t border-black/[0.06] pt-5 pr-1">
              <div>
                <p className="text-xs font-bold text-slate-400">开场白</p>
                <p className="mt-2 rounded-2xl bg-[#fbfaf7] p-4 text-sm leading-6 text-slate-600">
                  {displayAgent.greeting || `你好，我是 ${displayAgent.name}。告诉我你想完成什么，我们从第一步开始。`}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400">行为设定摘要</p>
                <div className="markdown-body mt-2 rounded-2xl bg-[#fbfaf7] p-4 text-xs leading-5 text-slate-500">
                  {/* <ReactMarkdown>
                    {displayAgent.systemPrompt || '这个 Agent 会根据用户的问题给出清晰、具体、可执行的帮助。'}
                  </ReactMarkdown> */}
                    <ReactMarkdown>
                    {'这个 Agent 会根据用户的问题给出清晰、具体、可执行的帮助。'}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-black/[0.06] bg-white/86 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => router.back()} className="rounded-full p-2 hover:bg-slate-100">
            <ArrowLeft size={20} />
          </button>
          <Avatar src={displayAgent.avatar} alt={displayAgent.name} size="sm" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-black text-slate-950">{displayAgent.name}</h1>
            <p className="text-xs font-medium text-slate-400">{displayAgent.category} · {displayAgent.tone}</p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-10">
          <div className="mx-auto max-w-4xl space-y-5">
            {messages.length <= 1 && !isStreaming && (
              <section className="rounded-[24px] bg-white/55 px-4 py-3">
                <div className="mb-3 flex items-center gap-2 text-xs font-bold text-slate-400">
                  <Sparkles size={14} style={{ color: categoryColor }} />
                  你可以这样问
                </div>
                <div className="flex flex-wrap gap-2">
                  {suggestedPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => handleSend(prompt)}
                      className="rounded-full bg-white px-4 py-2 text-sm font-bold leading-5 text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:text-slate-950"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {messages.map((message) => (
              <div key={message.id} className={cn('flex gap-3', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                {message.role === 'assistant' && (
                  <Avatar src={displayAgent.avatar} alt={displayAgent.name} size="sm" className="mt-1 shrink-0" />
                )}
                <div
                  className={cn(
                    'group relative max-w-[82%] rounded-[24px] px-5 py-4 shadow-sm',
                    message.role === 'user'
                      ? 'rounded-br-md text-white'
                      : 'rounded-bl-md border border-black/[0.06] bg-white text-slate-800'
                  )}
                  style={message.role === 'user' ? { backgroundColor: categoryColor } : undefined}
                >
                  {message.role === 'assistant' ? (
                    <div className="markdown-body text-sm leading-7">
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-7">{message.content}</p>
                  )}

                  {message.role === 'assistant' && (
                    <button
                      onClick={() => handleCopy(message.id, message.content)}
                      className="absolute -right-2 -top-2 rounded-full border border-black/[0.06] bg-white p-1.5 opacity-0 shadow-sm transition group-hover:opacity-100"
                      aria-label="复制回复"
                    >
                      {copiedId === message.id ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} className="text-slate-400" />}
                    </button>
                  )}
                </div>
              </div>
            ))}

            {isStreaming && streamingContent && (
              <div className="flex justify-start gap-3">
                <Avatar src={displayAgent.avatar} alt={displayAgent.name} size="sm" className="mt-1 shrink-0" />
                <div className="max-w-[82%] rounded-[24px] rounded-bl-md border border-black/[0.06] bg-white px-5 py-4 text-slate-800 shadow-sm">
                  <div className="markdown-body text-sm leading-7">
                    <ReactMarkdown>{streamingContent}</ReactMarkdown>
                  </div>
                  <span className="ml-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-slate-300" />
                </div>
              </div>
            )}

            {isStreaming && !streamingContent && (
              <div className="flex justify-start gap-3">
                <Avatar src={displayAgent.avatar} alt={displayAgent.name} size="sm" className="mt-1 shrink-0" />
                <div className="rounded-[24px] rounded-bl-md border border-black/[0.06] bg-white px-5 py-4 shadow-sm">
                  <div className="flex gap-1.5">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:150ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <footer className="border-t border-black/[0.06] bg-white/88 px-4 py-4 backdrop-blur sm:px-6">
          <div className="mx-auto max-w-4xl">
            <div className="flex items-end gap-3 rounded-[28px] border border-black/[0.08] bg-[#fbfaf7] p-2 shadow-sm">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`向 ${displayAgent.name} 说点什么...`}
                rows={1}
                className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-4 py-3 text-sm font-medium leading-6 text-slate-800 outline-none placeholder:text-slate-400"
              />
              {isStreaming ? (
                <button
                  onClick={handleStop}
                  className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-500 text-white"
                  aria-label="停止生成"
                >
                  <Square size={17} />
                </button>
              ) : (
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim()}
                  className={cn(
                    'mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition',
                    input.trim() ? 'text-white shadow-sm' : 'bg-slate-100 text-slate-400'
                  )}
                  style={input.trim() ? { backgroundColor: categoryColor } : undefined}
                  aria-label="发送消息"
                >
                  <Send size={17} />
                </button>
              )}
            </div>

            {messages.length > 1 && !isStreaming && (
              <div className="mt-3 flex justify-center">
                <button
                  onClick={handleRegenerate}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  <RefreshCw size={14} />
                  重新生成上一条回复
                </button>
              </div>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}
