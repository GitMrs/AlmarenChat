'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Check, ChevronDown, ChevronUp, Copy, ImagePlus, Loader2, RefreshCw, Send, SlidersHorizontal, Sparkles, Square, Trash2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Avatar from '@/components/shared/Avatar';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import LoginRequired from '@/components/auth/LoginRequired';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { getBuiltInAgents } from '@/lib/agents-data';
import { streamChat, conversations as conversationsApi, agents as agentsApi, user as userApi, uploads } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CATEGORY_COLORS } from '@/types';
import type { Agent, MessageAttachment } from '@/types';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: MessageAttachment[];
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

const USER_MESSAGE_COLLAPSE_CHARS = 600;
const USER_MESSAGE_COLLAPSE_LINES = 12;
const DEFAULT_CONTEXT_MESSAGE_LIMIT = 40;
const MAX_CONTEXT_MESSAGE_LIMIT = 80;

function formatMessageTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function CollapsibleUserMessage({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse =
    content.length > USER_MESSAGE_COLLAPSE_CHARS || content.split('\n').length > USER_MESSAGE_COLLAPSE_LINES;

  if (!shouldCollapse) {
    return <p className="whitespace-pre-wrap text-sm leading-7">{content}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <p
          className={cn(
            'whitespace-pre-wrap text-sm leading-7 transition-[max-height]',
            !expanded && 'max-h-56 overflow-hidden'
          )}
        >
          {content}
        </p>
        {!expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 rounded-b-[18px] bg-gradient-to-t from-black/12 via-black/4 to-transparent" />
        )}
      </div>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="inline-flex items-center text-xs font-black text-white/90 underline decoration-white/35 underline-offset-4 transition hover:text-white hover:decoration-white"
      >
        {expanded ? '收起消息' : '展开完整消息'}
      </button>
    </div>
  );
}

function MessageAttachments({ attachments }: { attachments?: MessageAttachment[] }) {
  const images = attachments?.filter((attachment) => attachment.type === 'image') || [];
  if (images.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {images.map((attachment) => (
        <a
          key={attachment.url}
          href={attachment.url}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-2xl border border-white/25 bg-white/15"
          onClick={(event) => event.stopPropagation()}
        >
          <img src={attachment.url} alt={attachment.name || '上传图片'} className="max-h-56 max-w-[240px] object-cover" />
        </a>
      ))}
    </div>
  );
}

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
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<ChatMessage | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [activeActionMessageId, setActiveActionMessageId] = useState<string | null>(null);
  const [userSettings, setUserSettings] = useState<{ apiBaseUrl?: string; apiKey?: string; modelName?: string } | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [contextMessageLimit, setContextMessageLimit] = useState(DEFAULT_CONTEXT_MESSAGE_LIMIT);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<MessageAttachment | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const updateViewportHeight = () => {
      const nextHeight = Math.floor(window.visualViewport?.height || window.innerHeight);
      setViewportHeight((current) => (Math.abs((current || 0) - nextHeight) > 1 ? nextHeight : current));
    };

    updateViewportHeight();
    window.visualViewport?.addEventListener('resize', updateViewportHeight);
    window.addEventListener('resize', updateViewportHeight);

    return () => {
      window.visualViewport?.removeEventListener('resize', updateViewportHeight);
      window.removeEventListener('resize', updateViewportHeight);
    };
  }, []);

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
          setIsLoggedIn(true);
          setContextMessageLimit(Math.max(1, Math.min(MAX_CONTEXT_MESSAGE_LIMIT, u.contextMessageLimit || DEFAULT_CONTEXT_MESSAGE_LIMIT)));
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
            setContextMessageLimit(
              Math.max(
                1,
                Math.min(
                  MAX_CONTEXT_MESSAGE_LIMIT,
                  conversation.contextMessageLimit || contextMessageLimit || DEFAULT_CONTEXT_MESSAGE_LIMIT
                )
              )
            );

            const { messages: existingMessages } = await conversationsApi.getMessages(existingConversationId);
            setMessages(
              existingMessages.map((msg: any) => ({
                id: msg.id,
                role: msg.role,
                content: msg.content,
                attachments: msg.attachments || [],
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
    if (isLoggedIn && initialPrompt && agent && messages.length <= 1 && !existingConversationId) {
      handleSend(initialPrompt);
    }
  }, [isLoggedIn, initialPrompt, agent, existingConversationId, messages.length]);

  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container) return;

    requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: isStreaming ? 'auto' : 'smooth',
      });
    });
  }, [messages.length, streamingContent, isStreaming]);

  useEffect(() => {
    setActiveActionMessageId(null);
  }, [messages.length]);

  const displayAgent = conversationAgent || agent;
  const categoryColor = displayAgent ? CATEGORY_COLORS[displayAgent.category || ''] || '#6366f1' : '#6366f1';
  const latestAssistantMessageId = [...messages].reverse().find((message) => message.role === 'assistant' && message.id !== 'greeting')?.id;
  const suggestedPrompts = useMemo(() => {
    if (!displayAgent) return ['你能帮我做什么？', '给我介绍一下你的能力', '我们从一个小任务开始'];
    return promptMap[displayAgent.category || ''] || ['你能帮我做什么？', '给我介绍一下你的能力', '我们从一个小任务开始'];
  }, [displayAgent]);

  const syncConversationMessages = async (id: string) => {
    const { messages: latestMessages } = await conversationsApi.getMessages(id);
    setMessages(
      latestMessages.map((msg: any) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        attachments: msg.attachments || [],
        createdAt: msg.createdAt,
      }))
    );
  };

  const uploadImageFile = async (file: File) => {
    if (!isLoggedIn) {
      setUploadError('登录后可以发送图片');
      return;
    }

    setUploadError('');
    setUploadingImage(true);
    try {
      const { attachment } = await uploads.image(file);
      setPendingAttachment(attachment);
    } catch (error: any) {
      setUploadError(error.message || '图片上传失败');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || uploadingImage) return;

    await uploadImageFile(file);
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith('image/'));
    if (!file) return;

    event.preventDefault();
    if (uploadingImage || isStreaming) return;

    await uploadImageFile(file);
  };

  const handleSend = async (
    text?: string,
    options: { reuseLastUserMessage?: boolean; historyOverride?: ChatMessage[]; attachmentsOverride?: MessageAttachment[] } = {}
  ) => {
    if (!isLoggedIn) {
      router.push('/login');
      return;
    }

    const content = text ?? input.trim();
    const outgoingAttachments = options.attachmentsOverride || (pendingAttachment ? [pendingAttachment] : []);
    if ((!content && outgoingAttachments.length === 0) || isStreaming || uploadingImage) return;

    if (!options.reuseLastUserMessage) {
      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content,
        attachments: outgoingAttachments,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput('');
      setPendingAttachment(null);
      setUploadError('');
    }
    setIsStreaming(true);
    setStreamingContent('');

    try {
      const historySource = options.historyOverride || messages;
      const history = historySource.map((message) => ({
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
        attachments: outgoingAttachments,
        contextMessageLimit,
        skipPersistUserMessage: options.reuseLastUserMessage,
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

      if (result.conversationId) {
        await syncConversationMessages(result.conversationId);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Chat error:', error);
        const errorContent = error.message || '抱歉，刚才生成失败了。你可以稍后再试，或换一种问法。';
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: errorContent,
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

  const handleRegenerate = async () => {
    const lastAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant' && message.id !== 'greeting');
    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    if (!lastUserMessage || isStreaming) return;

    if (lastAssistantMessage && conversationId && !lastAssistantMessage.id.startsWith('assistant-')) {
      await conversationsApi.deleteMessage(conversationId, lastAssistantMessage.id).catch(() => {});
    }

    const nextMessages = messages.filter((message) => message.id !== lastAssistantMessage?.id);
    setMessages(nextMessages);
    handleSend(lastUserMessage.content, {
      reuseLastUserMessage: true,
      historyOverride: nextMessages,
      attachmentsOverride: lastUserMessage.attachments || [],
    });
  };

  const handleCopy = (id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const deleteMessage = async () => {
    if (!pendingDeleteMessage || deletingMessageId) return;

    setDeletingMessageId(pendingDeleteMessage.id);
    try {
      if (conversationId && !pendingDeleteMessage.id.startsWith('user-') && !pendingDeleteMessage.id.startsWith('assistant-') && pendingDeleteMessage.id !== 'greeting') {
        await conversationsApi.deleteMessage(conversationId, pendingDeleteMessage.id);
      }
      setMessages((prev) => prev.filter((message) => message.id !== pendingDeleteMessage.id));
      setPendingDeleteMessage(null);
    } finally {
      setDeletingMessageId(null);
    }
  };

  const updateContextMessageLimit = async (value: number) => {
    if (!isLoggedIn) return;

    const nextLimit = Math.max(1, Math.min(MAX_CONTEXT_MESSAGE_LIMIT, Math.round(value || 1)));
    setContextMessageLimit(nextLimit);

    if (!conversationId) return;

    try {
      await conversationsApi.update(conversationId, { contextMessageLimit: nextLimit });
    } catch (error) {
      console.error('Update context message limit failed:', error);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#fbfaf7]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!displayAgent) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-[#fbfaf7]">
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
    <div
      className="fixed inset-0 flex overflow-hidden bg-[#fbfaf7] text-slate-950"
      style={{ height: viewportHeight ? `${viewportHeight}px` : '100dvh' }}
    >
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
          {isLoggedIn && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-[#fbfaf7] px-3 py-2">
              <div className="flex min-w-0 items-center gap-2 text-xs font-black text-slate-500">
                <SlidersHorizontal size={15} />
                <span>记忆</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={MAX_CONTEXT_MESSAGE_LIMIT}
                  value={contextMessageLimit}
                  onChange={(event) => updateContextMessageLimit(Number(event.target.value))}
                  className="h-8 w-16 rounded-xl border border-black/[0.06] bg-white px-2 text-center text-sm font-black text-slate-800 outline-none focus:border-slate-300"
                />
                <div className="whitespace-nowrap text-xs font-semibold text-slate-400">/ {MAX_CONTEXT_MESSAGE_LIMIT} 条</div>
              </div>
            </div>
          )}

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
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {/* 注意现在先不用详情，先展示默认的行为设定摘要 */}
                    {/* {displayAgent.systemPrompt || '这个 Agent 会根据用户的问题给出清晰、具体、可执行的帮助。'} */}
                    '这个 Agent 会根据用户的问题给出清晰、具体、可执行的帮助。‘
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-black/[0.06] bg-white/86 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => router.back()} className="rounded-full p-2 hover:bg-slate-100">
            <ArrowLeft size={20} />
          </button>
          <Avatar src={displayAgent.avatar} alt={displayAgent.name} size="sm" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-black text-slate-950">{displayAgent.name}</h1>
            <p className="text-xs font-medium text-slate-400">{displayAgent.category} · {displayAgent.tone}</p>
          </div>
          <button
            onClick={() => setDetailsOpen(true)}
            className="rounded-full border border-black/[0.06] bg-white px-3 py-2 text-xs font-black text-slate-600 shadow-sm"
          >
            详情
          </button>
        </header>

        {detailsOpen && (
          <div className="fixed inset-0 z-50 bg-slate-950/30 backdrop-blur-sm lg:hidden">
            <div className="absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-hidden rounded-t-[32px] bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar src={displayAgent.avatar} alt={displayAgent.name} size="sm" />
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-black text-slate-950">{displayAgent.name}</h2>
                    <p className="text-xs font-bold text-slate-400">{displayAgent.category || 'Agent'} · {displayAgent.tone || '默认语气'}</p>
                  </div>
                </div>
                <button onClick={() => setDetailsOpen(false)} className="rounded-full bg-[#fbfaf7] p-2 text-slate-500">
                  <X size={18} />
                </button>
              </div>

              <div className="max-h-[calc(82dvh-73px)] space-y-4 overflow-y-auto p-5">
                {isLoggedIn && (
                  <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-[#fbfaf7] px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2 text-xs font-black text-slate-500">
                      <SlidersHorizontal size={15} />
                      <span>记忆</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={MAX_CONTEXT_MESSAGE_LIMIT}
                        value={contextMessageLimit}
                        onChange={(event) => updateContextMessageLimit(Number(event.target.value))}
                        className="h-8 w-16 rounded-xl border border-black/[0.06] bg-white px-2 text-center text-sm font-black text-slate-800 outline-none focus:border-slate-300"
                      />
                      <div className="whitespace-nowrap text-xs font-semibold text-slate-400">/ {MAX_CONTEXT_MESSAGE_LIMIT} 条</div>
                    </div>
                  </div>
                )}
                <p className="rounded-2xl bg-[#fbfaf7] p-4 text-sm leading-6 text-slate-600">
                  {displayAgent.description || '这个 Agent 会根据你的问题给出清晰、具体、可执行的帮助。'}
                </p>
                <div>
                  <p className="text-xs font-bold text-slate-400">开场白</p>
                  <p className="mt-2 rounded-2xl bg-[#fbfaf7] p-4 text-sm leading-6 text-slate-600">
                    {displayAgent.greeting || `你好，我是 ${displayAgent.name}。告诉我你想完成什么，我们从第一步开始。`}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400">行为设定摘要</p>
                  <div className="markdown-body mt-2 rounded-2xl bg-[#fbfaf7] p-4 text-xs leading-5 text-slate-500">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {/* 注意现在先不用详情，先展示默认的行为设定摘要 */}
                      {/* {displayAgent.systemPrompt || '这个 Agent 会根据用户的问题给出清晰、具体、可执行的帮助。'} */}
                      '这个 Agent 会根据用户的问题给出清晰、具体、可执行的帮助。‘
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 scroll-pb-32 sm:px-6 lg:px-10">
          <div className="mx-auto max-w-4xl space-y-5">
            {!isLoggedIn && (
              <LoginRequired
                title="登录后开始聊天"
                description="聊天会消耗平台模型额度。登录后再开始对话，可以保护 API 额度，也能保存你的会话历史。"
              />
            )}

            {isLoggedIn && messages.length <= 1 && !isStreaming && (
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

            {isLoggedIn && messages.map((message) => (
              <div key={message.id} className={cn('flex gap-3', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                {message.role === 'assistant' && (
                  <Avatar src={displayAgent.avatar} alt={displayAgent.name} size="sm" className="mt-1 shrink-0" />
                )}
                <div
                  onClick={() => setActiveActionMessageId((current) => (current === message.id ? null : message.id))}
                  className={cn('group flex min-w-0 max-w-[82%] flex-col', message.role === 'user' ? 'items-end' : 'items-start')}
                >
                  <div
                    className={cn(
                      'min-w-0 max-w-full rounded-[24px] px-5 py-4 shadow-sm',
                      message.role === 'user'
                        ? 'rounded-br-md text-white'
                        : 'rounded-bl-md border border-black/[0.06] bg-white text-slate-800'
                    )}
                    style={message.role === 'user' ? { backgroundColor: categoryColor } : undefined}
                  >
                    <MessageAttachments attachments={message.attachments} />
                    {message.role === 'assistant' ? (
                      <div className="markdown-body min-w-0 max-w-full overflow-hidden text-sm leading-7">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                      </div>
                    ) : !message.content ? null : (
                      <CollapsibleUserMessage content={message.content} />
                    )}
                  </div>

                  {message.id !== 'greeting' && (
                    <div
                      className={cn(
                        'mt-1 flex items-center gap-1 px-2 text-slate-400 transition md:opacity-0 md:group-hover:opacity-100',
                        activeActionMessageId === message.id ? 'opacity-100' : 'opacity-0'
                      )}
                    >
                      <span
                        className="px-1 text-[11px] font-semibold leading-7"
                        title={new Intl.DateTimeFormat('zh-CN', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        }).format(new Date(message.createdAt))}
                      >
                        {formatMessageTime(message.createdAt)}
                      </span>
                      {message.role === 'assistant' && (
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            handleCopy(message.id, message.content);
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-slate-100 hover:text-slate-700"
                          title={copiedId === message.id ? '已复制' : '复制'}
                          aria-label="复制回复"
                        >
                          {copiedId === message.id ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                        </button>
                      )}
                      {message.role === 'assistant' && message.id === latestAssistantMessageId && (
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            handleRegenerate();
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-slate-100 hover:text-slate-700"
                          title="重新生成"
                          aria-label="重新生成"
                        >
                          <RefreshCw size={13} />
                        </button>
                      )}
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          setPendingDeleteMessage(message);
                        }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-rose-50 hover:text-rose-500"
                        title="删除"
                        aria-label="删除消息"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isLoggedIn && isStreaming && streamingContent && (
              <div className="flex justify-start gap-3">
                <Avatar src={displayAgent.avatar} alt={displayAgent.name} size="sm" className="mt-1 shrink-0" />
                <div className="min-w-0 max-w-[82%] rounded-[24px] rounded-bl-md border border-black/[0.06] bg-white px-5 py-4 text-slate-800 shadow-sm">
                  <div className="markdown-body min-w-0 max-w-full overflow-hidden text-sm leading-7">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
                  </div>
                  <span className="ml-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-slate-300" />
                </div>
              </div>
            )}

            {isLoggedIn && isStreaming && !streamingContent && (
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

        {isLoggedIn && (
        <footer className="shrink-0 border-t border-black/[0.06] bg-white/88 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 backdrop-blur sm:px-6">
          <div className="mx-auto max-w-4xl">
            {(pendingAttachment || uploadError) && (
              <div className="mb-2 flex items-center justify-between gap-3 rounded-2xl border border-black/[0.06] bg-white px-3 py-2 shadow-sm">
                {pendingAttachment ? (
                  <div className="flex min-w-0 items-center gap-3">
                    <img
                      src={pendingAttachment.url}
                      alt={pendingAttachment.name || '待发送图片'}
                      className="h-12 w-12 shrink-0 rounded-xl object-cover"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-700">{pendingAttachment.name || '已选择图片'}</p>
                      <p className="text-xs font-semibold text-slate-400">发送后会随本条消息交给 AI 分析</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-rose-500">{uploadError}</p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setPendingAttachment(null);
                    setUploadError('');
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="移除图片"
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <div className="flex items-end gap-3 rounded-[28px] border border-black/[0.08] bg-[#fbfaf7] p-2 shadow-sm">
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleImageSelect} />
              {isLoggedIn && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingImage || isStreaming}
                  className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-slate-500 transition hover:bg-white hover:text-slate-800 disabled:bg-transparent disabled:text-slate-300"
                  aria-label="上传图片"
                  title="上传图片"
                >
                  {uploadingImage ? <Loader2 size={17} className="animate-spin" /> : <ImagePlus size={18} />}
                </button>
              )}
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onPaste={handlePaste}
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
                  disabled={(!input.trim() && !pendingAttachment) || uploadingImage}
                  className={cn(
                    'mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition',
                    input.trim() || pendingAttachment ? 'text-white shadow-sm' : 'bg-slate-100 text-slate-400'
                  )}
                  style={input.trim() || pendingAttachment ? { backgroundColor: categoryColor } : undefined}
                  aria-label="发送消息"
                >
                  <Send size={17} />
                </button>
              )}
            </div>
          </div>
        </footer>
        )}
      </main>
      <ConfirmDialog
        open={Boolean(pendingDeleteMessage)}
        title="删除这条消息？"
        description="删除后不会再出现在当前会话里。"
        icon={<Trash2 size={20} />}
        cancelText="先保留"
        confirmText="确认删除"
        destructive
        loading={Boolean(pendingDeleteMessage && deletingMessageId === pendingDeleteMessage.id)}
        onCancel={() => setPendingDeleteMessage(null)}
        onConfirm={deleteMessage}
      />
    </div>
  );
}
