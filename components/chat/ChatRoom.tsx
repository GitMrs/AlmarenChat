'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, Loader2, Sparkles, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Avatar from '@/components/shared/Avatar';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import LoginRequired from '@/components/auth/LoginRequired';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import AgentDetailsPanel from '@/components/chat/AgentDetailsPanel';
import ChatComposer from '@/components/chat/ChatComposer';
import { MessageItem } from '@/components/chat/ChatMessageItem';
import { getBuiltInAgents } from '@/lib/agents-data';
import { generateConversationImage, streamChat, conversations as conversationsApi, agents as agentsApi, user as userApi, uploads } from '@/lib/api';
import {
  DEFAULT_BROWSER_MODEL_CONFIG,
  readBrowserModelConfigForScope,
  streamBrowserModel,
} from '@/lib/browser-model';
import { cn } from '@/lib/utils';
import { CATEGORY_COLORS } from '@/types';
import type { Agent, MessageAttachment } from '@/types';
import type { ChatMessage, DisplayAgent } from '@/components/chat/ChatMessageItem';
import type { BrowserModelConfig } from '@/lib/browser-model';

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

const DEFAULT_CONTEXT_MESSAGE_LIMIT = 40;
const MAX_CONTEXT_MESSAGE_LIMIT = 80;
const MESSAGE_PAGE_SIZE = 30;
const LARGE_PASTE_TEXT_LIMIT = 8000;

function getLargeTextKind(text: string) {
  try {
    JSON.parse(text);
    return 'json' as const;
  } catch {
    return 'text' as const;
  }
}

function imageUrlToDataUrl(url: string) {
  if (url.startsWith('data:')) return Promise.resolve(url);

  return fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error('读取图片失败');
      return response.blob();
    })
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('读取图片失败'));
          reader.readAsDataURL(blob);
        })
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
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<ChatMessage | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [activeActionMessageId, setActiveActionMessageId] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [clearingMessages, setClearingMessages] = useState(false);
  const [userSettings, setUserSettings] = useState<{
    apiBaseUrl?: string;
    apiKey?: string;
    modelName?: string;
    imageGenerationAvailable?: boolean;
    imageModelSize?: '1024x1024' | '1536x1024' | '1024x1536';
  } | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [contextMessageLimit, setContextMessageLimit] = useState(DEFAULT_CONTEXT_MESSAGE_LIMIT);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [viewportOffsetTop, setViewportOffsetTop] = useState(0);
  const [pendingAttachment, setPendingAttachment] = useState<MessageAttachment | null>(null);
  const [pendingLargeTextMeta, setPendingLargeTextMeta] = useState<{ chars: number; kind: 'json' | 'text' } | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [chatMode, setChatMode] = useState<'chat' | 'image'>('chat');
  const [browserModelConfig, setBrowserModelConfig] = useState<BrowserModelConfig>({ ...DEFAULT_BROWSER_MODEL_CONFIG });
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const [shouldStickToBottom, setShouldStickToBottom] = useState(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const pendingPrependScrollRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);

  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const forceScrollToBottomRef = useRef(false);
  const pendingLargeTextRef = useRef<string | null>(null);
  const largeTextPasteGuardRef = useRef(false);
  const skipNextEmptyInputRef = useRef(false);
  const ignoreInputUntilRef = useRef(0);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    setBrowserModelConfig(readBrowserModelConfigForScope('GLOBAL'));
  }, []);

  useEffect(() => {
    const updateViewportHeight = () => {
      const viewport = window.visualViewport;
      const nextHeight = Math.floor(viewport?.height || window.innerHeight);
      const nextOffsetTop = Math.floor(viewport?.offsetTop || 0);
      setViewportHeight((current) => (Math.abs((current || 0) - nextHeight) > 1 ? nextHeight : current));
      setViewportOffsetTop((current) => (Math.abs(current - nextOffsetTop) > 1 ? nextOffsetTop : current));
    };

    updateViewportHeight();
    window.visualViewport?.addEventListener('resize', updateViewportHeight);
    window.visualViewport?.addEventListener('scroll', updateViewportHeight);
    window.addEventListener('resize', updateViewportHeight);

    return () => {
      window.visualViewport?.removeEventListener('resize', updateViewportHeight);
      window.visualViewport?.removeEventListener('scroll', updateViewportHeight);
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
          setUserSettings({
            ...(u.customModelEnabled && u.apiBaseUrl && u.apiKey && u.modelName
              ? { apiBaseUrl: u.apiBaseUrl, apiKey: u.apiKey, modelName: u.modelName }
              : {}),
            imageGenerationAvailable: Boolean(u.imageModelEnabled && u.apiBaseUrl && u.apiKey && u.imageModelName),
            imageModelSize: u.imageModelSize || '1024x1024',
          });
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

            const { messages: existingMessages, hasMore } = await conversationsApi.getMessages(existingConversationId, {
              limit: MESSAGE_PAGE_SIZE,
            });
            setHasMoreMessages(Boolean(hasMore));
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
    setActiveActionMessageId(null);
  }, [messages.length]);

  const displayAgent = conversationAgent || agent;
  const categoryColor = displayAgent ? CATEGORY_COLORS[displayAgent.category || ''] || '#6366f1' : '#6366f1';
  const latestAssistantMessageId = [...messages].reverse().find((message) => message.role === 'assistant' && message.id !== 'greeting')?.id;

  useEffect(() => {
    if (!shouldStickToBottom) {
      return;
    }

    const container = messagesScrollRef.current;
    if (!container) return;

    requestAnimationFrame(() => {
      if (forceScrollToBottomRef.current) {
        container.scrollTo({ top: container.scrollHeight });
        forceScrollToBottomRef.current = false;
        return;
      }

      container.scrollTo({ top: container.scrollHeight, behavior: isStreaming ? 'auto' : 'smooth' });
    });
  }, [messages.length, streamingContent, isStreaming, shouldStickToBottom, viewportHeight, viewportOffsetTop]);

  useEffect(() => {
    const previous = pendingPrependScrollRef.current;
    const container = messagesScrollRef.current;
    if (!previous || !container) return;

    requestAnimationFrame(() => {
      const heightDelta = container.scrollHeight - previous.scrollHeight;
      container.scrollTop = previous.scrollTop + heightDelta;
      pendingPrependScrollRef.current = null;
    });
  }, [messages]);
  const suggestedPrompts = useMemo(() => {
    if (!displayAgent) return ['你能帮我做什么？', '给我介绍一下你的能力', '我们从一个小任务开始'];
    return promptMap[displayAgent.category || ''] || ['你能帮我做什么？', '给我介绍一下你的能力', '我们从一个小任务开始'];
  }, [displayAgent]);

  const toChatMessage = (msg: any): ChatMessage => ({
    id: msg.id,
    role: msg.role,
    content: msg.content,
    attachments: msg.attachments || [],
    createdAt: msg.createdAt,
  });

  const syncConversationMessages = async (id: string, localPendingMessages: ChatMessage[] = []) => {
    const { messages: latestMessages, hasMore } = await conversationsApi.getMessages(id, { limit: MESSAGE_PAGE_SIZE });
    setHasMoreMessages(Boolean(hasMore));
    const serverMessages = latestMessages.map(toChatMessage);
    const serverMessageKeys = new Set(
      serverMessages.map((message) => `${message.role}|${message.content}|${message.attachments?.map((attachment) => attachment.url).join(',') || ''}`)
    );
    const pendingMessages = localPendingMessages.filter((message) => {
      if (!message.id.startsWith('user-') && !message.id.startsWith('assistant-') && !message.id.startsWith('error-')) return false;
      const key = `${message.role}|${message.content}|${message.attachments?.map((attachment) => attachment.url).join(',') || ''}`;
      return !serverMessageKeys.has(key);
    });
    const nextMessages = [...serverMessages, ...pendingMessages];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
  };

  const loadMoreMessages = async () => {
    if (!conversationId || loadingMoreMessages || !hasMoreMessages || messages.length === 0) return;

    const oldestMessage = messages[0];
    const container = messagesScrollRef.current;
    pendingPrependScrollRef.current = container
      ? {
          scrollHeight: container.scrollHeight,
          scrollTop: container.scrollTop,
        }
      : null;

    setLoadingMoreMessages(true);
    setShouldStickToBottom(false);
    try {
      const { messages: olderMessages, hasMore } = await conversationsApi.getMessages(conversationId, {
        before: oldestMessage.createdAt,
        limit: MESSAGE_PAGE_SIZE,
      });

      setHasMoreMessages(Boolean(hasMore));
      if (olderMessages.length > 0) {
        setMessages((current) => [...olderMessages.map((msg: any) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          attachments: msg.attachments || [],
          createdAt: msg.createdAt,
        })), ...current]);

      }
    } finally {
      setLoadingMoreMessages(false);
    }
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
    if (!file) {
      const text = event.clipboardData.getData('text');
      if (text.length <= LARGE_PASTE_TEXT_LIMIT) return;

      event.preventDefault();
      pendingLargeTextRef.current = text;
      largeTextPasteGuardRef.current = true;
      ignoreInputUntilRef.current = Date.now() + 1000;
      setPendingLargeTextMeta({ chars: text.length, kind: getLargeTextKind(text) });
      if (inputRef.current) {
        skipNextEmptyInputRef.current = true;
        inputRef.current.value = '';
      }
      return;
    }

    event.preventDefault();
    if (uploadingImage || isStreaming) return;

    await uploadImageFile(file);
  };

  const handleMessagesScroll = () => {
    const container = messagesScrollRef.current;
    if (!container) return;

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShouldStickToBottom(distanceFromBottom < 120);
    setShowJumpToBottom(distanceFromBottom > 260);

    if (container.scrollTop <= 80) {
      loadMoreMessages();
    }
  };

  const jumpToBottom = () => {
    setShouldStickToBottom(true);
    setShowJumpToBottom(false);
    forceScrollToBottomRef.current = true;
    messagesScrollRef.current?.scrollTo({ top: messagesScrollRef.current.scrollHeight, behavior: 'smooth' });
  };

  const handleSend = async (
    text?: string,
    options: {
      reuseLastUserMessage?: boolean;
      historyOverride?: ChatMessage[];
      attachmentsOverride?: MessageAttachment[];
      modeOverride?: 'chat' | 'image';
    } = {}
  ) => {
    if (!isLoggedIn) {
      router.push('/login');
      return;
    }

    const content = text ?? pendingLargeTextRef.current ?? inputRef.current?.value.trim() ?? '';
    const outgoingAttachments = options.attachmentsOverride || (pendingAttachment ? [pendingAttachment] : []);
    const requestMode = options.modeOverride || chatMode;
    if (requestMode === 'image' && outgoingAttachments.length > 0) return;
    if ((!content && outgoingAttachments.length === 0) || isStreaming || uploadingImage) return;

    setShouldStickToBottom(true);
    setShowJumpToBottom(false);
    forceScrollToBottomRef.current = true;

    let nextLocalMessages = messagesRef.current;
    if (!options.reuseLastUserMessage) {
      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content,
        attachments: outgoingAttachments,
        createdAt: new Date().toISOString(),
      };

      nextLocalMessages = [...messagesRef.current, userMessage];
      messagesRef.current = nextLocalMessages;
      setMessages(nextLocalMessages);
      if (inputRef.current && text === undefined) {
        inputRef.current.value = '';
      }
      pendingLargeTextRef.current = null;
      setPendingLargeTextMeta(null);
      setPendingAttachment(null);
      setUploadError('');
    }
    setIsStreaming(true);
    setStreamingContent('');

    try {
      const historySource = options.historyOverride || nextLocalMessages;
      const history = historySource.map((message) => ({
        role: message.role,
        content: message.content,
      }));

      const controller = new AbortController();
      abortRef.current = controller;

      const agentSnapshot = displayAgent
        ? {
            name: displayAgent.name,
            avatar: displayAgent.avatar,
            category: displayAgent.category,
            tone: displayAgent.tone,
            description: displayAgent.description,
            systemPrompt: displayAgent.systemPrompt,
          }
        : undefined;
      const usesBrowserModel = browserModelConfig.source === 'OLLAMA';
      let result: { stream: ReadableStream<Uint8Array>; conversationId?: string };

      if (requestMode === 'image') {
        if (!userSettings?.imageGenerationAvailable || usesBrowserModel) {
          throw new Error('请先在账号设置中启用并完整配置图片生成模型');
        }
        let localConversationId = conversationId || undefined;
        if (!localConversationId) {
          const created = await conversationsApi.create({
            agentId: displayAgent?.id || agentId,
            title: content.slice(0, 50) || '图片会话',
            agentSnapshot,
          });
          localConversationId = created.conversation.id;
          setConversationId(localConversationId);
        }
        const generated = await generateConversationImage({
          conversationId: localConversationId,
          prompt: content,
          size: userSettings.imageModelSize,
          skipPersistUserMessage: options.reuseLastUserMessage,
          signal: controller.signal,
        });
        const assistantMessage = toChatMessage(generated.message);
        const messagesWithAssistant = [...messagesRef.current, assistantMessage];
        messagesRef.current = messagesWithAssistant;
        setMessages(messagesWithAssistant);
        setStreamingContent('');
        await syncConversationMessages(localConversationId, messagesWithAssistant);
        return;
      }

      if (usesBrowserModel) {
        if (webSearchEnabled) {
          throw new Error('浏览器直连 Ollama 时不能使用服务端联网搜索');
        }

        let localConversationId = conversationId || undefined;
        if (!localConversationId) {
          const created = await conversationsApi.create({
            agentId: displayAgent?.id || agentId,
            title: content.slice(0, 50) || (outgoingAttachments.length > 0 ? '图片会话' : '新会话'),
            agentSnapshot,
          });
          localConversationId = created.conversation.id;
          setConversationId(localConversationId);
        }

        if (!options.reuseLastUserMessage) {
          await conversationsApi.sendMessage(localConversationId, content, {
            role: 'user',
            attachments: outgoingAttachments,
          });
        }

        const modelMessages: { role: 'system' | 'user' | 'assistant'; content: any }[] = historySource
          .filter((message) => !message.id.startsWith('error-'))
          .slice(-contextMessageLimit)
          .map((message) => ({
            role: message.role,
            content: message.content,
          }));

        if (outgoingAttachments.length > 0 && modelMessages.length > 0) {
          const imageContent = await Promise.all(
            outgoingAttachments.map(async (attachment) => ({
              type: 'image_url',
              image_url: { url: await imageUrlToDataUrl(attachment.url) },
            }))
          );
          modelMessages[modelMessages.length - 1].content = [
            { type: 'text', text: content || '请分析这张图片。' },
            ...imageContent,
          ];
        }
        if (displayAgent?.systemPrompt) {
          modelMessages.unshift({ role: 'system', content: displayAgent.systemPrompt });
        }

        result = {
          stream: await streamBrowserModel({
            config: browserModelConfig,
            messages: modelMessages,
            signal: controller.signal,
          }),
          conversationId: localConversationId,
        };
      } else {
        result = await streamChat({
          message: content,
          history,
          context: displayAgent?.systemPrompt,
          conversationId: conversationId || undefined,
          agentId: displayAgent?.id || agentId,
          attachments: outgoingAttachments,
          contextMessageLimit,
          skipPersistUserMessage: options.reuseLastUserMessage,
          webSearchEnabled,
          knowledgeEnabled: true,
          agentSnapshot,
          ...(userSettings?.apiBaseUrl && userSettings.apiKey && userSettings.modelName
            ? {
                apiBaseUrl: userSettings.apiBaseUrl,
                apiKey: userSettings.apiKey,
                modelName: userSettings.modelName,
              }
            : {}),
          signal: controller.signal,
        });
      }

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

      const messagesWithAssistant = [...messagesRef.current, assistantMessage];
      messagesRef.current = messagesWithAssistant;
      setMessages(messagesWithAssistant);
      setIsStreaming(false);
      setStreamingContent('');

      if (result.conversationId) {
        if (usesBrowserModel && fullContent) {
          await conversationsApi.sendMessage(result.conversationId, fullContent, { role: 'assistant' });
        }
        await syncConversationMessages(result.conversationId, messagesWithAssistant);
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
      if (browserModelConfig.source === 'OLLAMA' && conversationId) {
        conversationsApi.sendMessage(conversationId, streamingContent, { role: 'assistant' }).catch(() => {});
      }
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
    const regenerateMode = lastAssistantMessage?.attachments?.some((attachment) => attachment.origin === 'generated')
      ? 'image'
      : 'chat';
    setMessages(nextMessages);
    handleSend(lastUserMessage.content, {
      reuseLastUserMessage: true,
      historyOverride: nextMessages,
      attachmentsOverride: lastUserMessage.attachments || [],
      modeOverride: regenerateMode,
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

  const handleClearMessages = async () => {
    const targetConversationId = conversationId || existingConversationId;
    setClearingMessages(true);
    try {
      if (targetConversationId) {
        await conversationsApi.clearMessages(targetConversationId);
      }
      setMessages([]);
      setHasMoreMessages(false);
      setConfirmClearOpen(false);
    } catch (error: any) {
      console.error('Clear messages failed:', error);
    } finally {
      setClearingMessages(false);
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

  const handleComposerFocus = () => {
    if (!shouldStickToBottom) return;

    requestAnimationFrame(() => {
      messagesScrollRef.current?.scrollTo({ top: messagesScrollRef.current.scrollHeight });
    });
    window.setTimeout(() => {
      messagesScrollRef.current?.scrollTo({ top: messagesScrollRef.current.scrollHeight });
      const value = inputRef.current?.value || '';
      if (value.length > LARGE_PASTE_TEXT_LIMIT) {
        pendingLargeTextRef.current = value;
        ignoreInputUntilRef.current = Date.now() + 1000;
        setPendingLargeTextMeta({ chars: value.length, kind: getLargeTextKind(value) });
        if (inputRef.current) {
          inputRef.current.value = '';
        }
      }
    }, 260);
  };

  const handleComposerInput = (event: React.FormEvent<HTMLTextAreaElement>) => {
    if (largeTextPasteGuardRef.current) {
      largeTextPasteGuardRef.current = false;
      if (inputRef.current) {
        skipNextEmptyInputRef.current = true;
        inputRef.current.value = '';
      }
      return;
    }
    const value = event.currentTarget.value;
    if (Date.now() < ignoreInputUntilRef.current) {
      event.currentTarget.value = '';
      return;
    }
    if (skipNextEmptyInputRef.current && value === '') {
      skipNextEmptyInputRef.current = false;
      return;
    }
    if (value.length > LARGE_PASTE_TEXT_LIMIT) {
      pendingLargeTextRef.current = value;
      ignoreInputUntilRef.current = Date.now() + 1000;
      setPendingLargeTextMeta({ chars: value.length, kind: getLargeTextKind(value) });
      skipNextEmptyInputRef.current = true;
      event.currentTarget.value = '';
      return;
    }
    if (!pendingLargeTextRef.current) return;
    if (value.trim() === '') return;
    pendingLargeTextRef.current = null;
    setPendingLargeTextMeta(null);
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
      className="fixed inset-0 flex flex-col overflow-hidden bg-[#fbfaf7] text-slate-950 lg:flex-row"
      style={{
        height: viewportHeight ? `${viewportHeight}px` : '100dvh',
        top: viewportOffsetTop ? `${viewportOffsetTop}px` : 0,
      }}
    >
      <AgentDetailsPanel
        displayAgent={displayAgent}
        categoryColor={categoryColor}
        detailsOpen={detailsOpen}
        mobileDetailsOpen={mobileDetailsOpen}
        isLoggedIn={isLoggedIn}
        contextMessageLimit={contextMessageLimit}
        maxContextMessageLimit={MAX_CONTEXT_MESSAGE_LIMIT}
        modelConfig={browserModelConfig}
        onBack={() => router.back()}
        onToggleDetails={() => setDetailsOpen((value) => !value)}
        onOpenMobileDetails={() => setMobileDetailsOpen(true)}
        onCloseMobileDetails={() => setMobileDetailsOpen(false)}
        onContextMessageLimitChange={updateContextMessageLimit}
      />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={messagesScrollRef}
          onScroll={handleMessagesScroll}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 pt-5 scroll-pb-40 sm:px-6 lg:px-10"
        >
          <div className="mx-auto max-w-4xl space-y-5">
            {!isLoggedIn && (
              <LoginRequired
                title="登录后开始聊天"
                description="聊天会消耗平台模型额度。登录后再开始对话，可以保护 API 额度，也能保存你的会话历史。"
              />
            )}

            {isLoggedIn && existingConversationId && hasMoreMessages && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={loadMoreMessages}
                  disabled={loadingMoreMessages}
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-black/[0.06] bg-white px-4 text-xs font-black text-slate-500 shadow-sm transition hover:text-slate-950 disabled:text-slate-300"
                >
                  {loadingMoreMessages && <Loader2 size={14} className="animate-spin" />}
                  加载更早消息
                </button>
              </div>
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

            {isLoggedIn &&
              messages.map((message) => (
                <MessageItem
                  key={message.id}
                  message={message}
                  displayAgent={displayAgent}
                  categoryColor={categoryColor}
                  latestAssistantMessageId={latestAssistantMessageId}
                  copiedId={copiedId}
                  activeActionMessageId={activeActionMessageId}
                  onActivate={(id) => setActiveActionMessageId((current) => (current === id ? null : id))}
                  onCopy={handleCopy}
                  onRegenerate={handleRegenerate}
                  onDelete={setPendingDeleteMessage}
                />
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
          </div>
          {isLoggedIn && showJumpToBottom && (
            <button
              type="button"
              onClick={jumpToBottom}
              className="sticky bottom-3 left-full z-10 ml-auto mt-3 flex h-9 w-9 -translate-x-2 items-center justify-center rounded-full border border-black/[0.04] bg-white/75 text-[0px] text-slate-400 shadow-sm backdrop-blur transition hover:bg-white hover:text-slate-700 hover:shadow-md"
              title="回到底部"
              aria-label="回到底部"
            >
              回到底部
              <ChevronDown size={16} />
            </button>
          )}
        </div>

        {isLoggedIn && (
          <ChatComposer
            agentName={displayAgent.name}
            categoryColor={categoryColor}
            pendingAttachment={pendingAttachment}
            pendingLargeTextMeta={pendingLargeTextMeta}
            uploadError={uploadError}
            uploadingImage={uploadingImage}
            isStreaming={isStreaming}
            inputRef={inputRef}
            fileInputRef={fileInputRef}
            onImageSelect={handleImageSelect}
            onPaste={handlePaste}
            onInput={handleComposerInput}
            onKeyDown={handleKeyDown}
            onFocus={handleComposerFocus}
            onClearAttachment={() => {
              setPendingAttachment(null);
              pendingLargeTextRef.current = null;
              setPendingLargeTextMeta(null);
              setUploadError('');
            }}
            onSend={() => handleSend()}
            onStop={handleStop}
            webSearchEnabled={webSearchEnabled}
            onToggleWebSearch={() => setWebSearchEnabled((value) => !value)}
            mode={chatMode}
            onClearMessages={() => setConfirmClearOpen(true)}
            canClearMessages={messages.length > 0}
            imageGenerationAvailable={Boolean(userSettings?.imageGenerationAvailable) && browserModelConfig.source !== 'OLLAMA'}
            onModeChange={(mode) => {
              setChatMode(mode);
              if (mode === 'image') setWebSearchEnabled(false);
            }}
          />
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
