'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, Compass, Loader2, Sparkles, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Avatar from '@/components/shared/Avatar';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import LoginRequired from '@/components/auth/LoginRequired';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import AgentDetailsPanel from '@/components/chat/AgentDetailsPanel';
import ChatComposer from '@/components/chat/ChatComposer';
import PlayContextPanel from '@/components/chat/PlayContextPanel';
import { MessageItem } from '@/components/chat/ChatMessageItem';
import { getBuiltInAgents } from '@/lib/agents-data';
import { streamChat, conversations as conversationsApi, agents as agentsApi, user as userApi, uploads } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CATEGORY_COLORS } from '@/types';
import type { Agent, MessageAttachment } from '@/types';
import type { ChatMessage, DisplayAgent } from '@/components/chat/ChatMessageItem';
import type { RuntimeState } from '@/types/runtime';
import type { BlueprintRuntimeState, MysteryBlueprint } from '@/types/blueprint';

const promptMap: Record<string, string[]> = {
  悬疑推理: ['我发现了一个可疑线索', '带我去案发现场', '我想审问嫌疑人'],
  浪漫言情: ['故事从哪里开始？', '我想了解这个角色', '接下来会发生什么？'],
  奇幻冒险: ['我准备好了，出发！', '这个世界有什么传说？', '我想探索那片区域'],
  都市剧情: ['我的角色是谁？', '今天发生了什么事？', '我想和那个人谈谈'],
  社交推理: ['游戏开始了', '我怀疑那个人', '我想进行一轮讨论'],
  心理博弈: ['来一场较量', '你的策略是什么？', '我想分析当前局势'],
  喜剧搞笑: ['来点开心的', '讲个笑话吧', '我们来玩个游戏'],
  恐怖惊悚: ['我准备好了...大概', '那里有什么？', '我不该打开那扇门的...'],
  科幻探索: ['飞船准备就绪', '前方有什么星球？', '启动跃迁引擎'],
};

const DEFAULT_CONTEXT_MESSAGE_LIMIT = 40;
const MAX_CONTEXT_MESSAGE_LIMIT = 80;
const MESSAGE_PAGE_SIZE = 30;
const LARGE_PASTE_TEXT_LIMIT = 8000;

type EngineRuntimeState = {
  engine: 'blueprint-v1';
  blueprint: MysteryBlueprint;
  state: BlueprintRuntimeState;
  nextActionIds: string[];
};

function stripRuntimeBlock(text: string): string {
  // Strip complete runtime block
  let result = text.replace(/\n?```runtime\n[\s\S]*?```/, '');
  // Strip incomplete runtime block (during streaming, closing ``` not yet received)
  result = result.replace(/\n?```runtime\n[\s\S]*$/, '');
  return result.trim();
}

function hasBlueprintConfig(agent: any) {
  if (!agent?.builderConfig) return false;
  try {
    return Boolean(JSON.parse(agent.builderConfig)?.blueprint);
  } catch {
    return false;
  }
}

function getLargeTextKind(text: string) {
  try {
    JSON.parse(text);
    return 'json' as const;
  } catch {
    return 'text' as const;
  }
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
  const [userSettings, setUserSettings] = useState<{ apiBaseUrl?: string; apiKey?: string; modelName?: string } | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [contextMessageLimit, setContextMessageLimit] = useState(DEFAULT_CONTEXT_MESSAGE_LIMIT);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [viewportOffsetTop, setViewportOffsetTop] = useState(0);
  const [pendingAttachment, setPendingAttachment] = useState<MessageAttachment | null>(null);
  const [pendingLargeTextMeta, setPendingLargeTextMeta] = useState<{ chars: number; kind: 'json' | 'text' } | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [playContextOpen, setPlayContextOpen] = useState(false);
  const [runtimeState, setRuntimeState] = useState<RuntimeState | null>(null);
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
  const creatingEngineConversationRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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

            // Parse runtime state
            if (conversation.runtimeState) {
              try {
                setRuntimeState(JSON.parse(conversation.runtimeState));
                setPlayContextOpen(true);
              } catch {}
            }

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
    if (
      !isLoggedIn ||
      !agentId ||
      !agent ||
      existingConversationId ||
      conversationId ||
      runtimeState ||
      !hasBlueprintConfig(agent) ||
      creatingEngineConversationRef.current
    ) {
      return;
    }

    creatingEngineConversationRef.current = true;
    conversationsApi
      .create({ agentId })
      .then(({ conversation }) => {
        setConversationId(conversation.id);
        setConversationAgent({
          id: conversation.agentId || agentId,
          name: conversation.agentName || agent.name,
          avatar: conversation.agentAvatar || agent.avatar,
          description: conversation.agentDescription || agent.description,
          category: conversation.agentCategory || agent.category,
          tone: conversation.agentTone || agent.tone,
          systemPrompt: conversation.agentSystemPrompt || agent.systemPrompt,
          greeting: agent.greeting,
        });
        if (conversation.runtimeState) {
          setRuntimeState(JSON.parse(conversation.runtimeState));
          setPlayContextOpen(true);
        }
      })
      .finally(() => {
        creatingEngineConversationRef.current = false;
      });
  }, [agent, agentId, conversationId, existingConversationId, isLoggedIn, runtimeState]);

  useEffect(() => {
    setActiveActionMessageId(null);
  }, [messages.length]);

  const displayAgent = conversationAgent || agent;
  const categoryColor = displayAgent ? CATEGORY_COLORS[displayAgent.category || ''] || '#6366f1' : '#6366f1';
  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant' && message.id !== 'greeting');
  const latestAssistantMessageId = latestAssistantMessage?.id;
  const latestActionHostMessageId = [...messages].reverse().find((message) => message.role === 'assistant')?.id;
  const engineRuntime = runtimeState && (runtimeState as any).engine === 'blueprint-v1'
    ? (runtimeState as unknown as EngineRuntimeState)
    : null;
  const engineActions = engineRuntime
    ? engineRuntime.nextActionIds
        .map((actionId) => engineRuntime.blueprint.actions.find((action) => action.id === actionId))
        .filter(Boolean)
    : [];
  const engineCanAccuse = Boolean(
    engineRuntime?.blueprint.accusation &&
      !engineRuntime.state.endedAt &&
      engineRuntime.blueprint.accusation.requiredClueIds.every((clueId: string) =>
        engineRuntime.state.discoveredClueIds.includes(clueId)
      ) &&
      engineRuntime.blueprint.accusation.enabledWhen.every((condition: any) => {
        if (condition.type === 'hasClue') return engineRuntime.state.discoveredClueIds.includes(condition.clueId);
        if (condition.type === 'hasItem') return engineRuntime.state.inventoryItemIds.includes(condition.itemId);
        if (condition.type === 'flag') return engineRuntime.state.flags[condition.key] === condition.value;
        if (condition.type === 'flagNot') return engineRuntime.state.flags[condition.key] !== condition.value;
        if (condition.type === 'inScene') return engineRuntime.state.sceneId === condition.sceneId;
        return false;
      })
  );

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

    // For mystery cases with builderConfig, generate contextual prompts
    if (agent?.creationType === 'mystery' && agent?.builderConfig) {
      try {
        const config = JSON.parse(agent.builderConfig);
        const publicClues = (config.clues || [])
          .filter((c: any) => c.visibility === 'public')
          .slice(0, 3);
        const prompts: string[] = [];
        if (config.openingScene) {
          prompts.push('带我去案发现场看看');
        }
        for (const clue of publicClues) {
          if (clue.name) prompts.push(`检查${clue.name}`);
        }
        if ((config.suspects || []).length > 0) {
          prompts.push(`审问嫌疑人${config.suspects[0].name || ''}`);
        }
        if (prompts.length >= 3) return prompts.slice(0, 4);
      } catch {}
    }

    return promptMap[displayAgent.category || ''] || ['你能帮我做什么？', '给我介绍一下你的能力', '我们从一个小任务开始'];
  }, [displayAgent, agent]);

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
    options: { reuseLastUserMessage?: boolean; historyOverride?: ChatMessage[]; attachmentsOverride?: MessageAttachment[] } = {}
  ) => {
    if (!isLoggedIn) {
      router.push('/login');
      return;
    }

    const content = text ?? pendingLargeTextRef.current ?? inputRef.current?.value.trim() ?? '';
    const outgoingAttachments = options.attachmentsOverride || (pendingAttachment ? [pendingAttachment] : []);
    if ((!content && outgoingAttachments.length === 0) || isStreaming || uploadingImage) return;

    if (engineRuntime) {
      const matchedAction = engineActions.find((action: any) => action.label === content || action.id === content);
      if (matchedAction) {
        handleEngineAction(matchedAction.id);
      }
      return;
    }

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
        // Strip runtime block from display during streaming
        const displayContent = stripRuntimeBlock(fullContent);
        setStreamingContent(displayContent || fullContent);
      }

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: stripRuntimeBlock(fullContent) || fullContent,
        createdAt: new Date().toISOString(),
      };

      const messagesWithAssistant = [...messagesRef.current, assistantMessage];
      messagesRef.current = messagesWithAssistant;
      setMessages(messagesWithAssistant);
      setIsStreaming(false);
      setStreamingContent('');

      if (result.conversationId) {
        await syncConversationMessages(result.conversationId, messagesWithAssistant);

        // Re-fetch runtime state after AI response
        try {
          const { conversation: updated } = await conversationsApi.get(result.conversationId);
          if (updated.runtimeState) {
            setRuntimeState(JSON.parse(updated.runtimeState));
          }
        } catch {}
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

  const handleEngineAction = async (actionId: string) => {
    if (!conversationId || isStreaming) return;

    const action = engineRuntime?.blueprint.actions.find((item) => item.id === actionId);
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: action?.label || actionId,
      createdAt: new Date().toISOString(),
    };

    setShouldStickToBottom(true);
    setShowJumpToBottom(false);
    forceScrollToBottomRef.current = true;
    setMessages((current) => [...current, userMessage]);

    try {
      const { result, runtimeState: nextRuntimeState, messages: persistedMessages } = await conversationsApi.engineAction(conversationId, actionId);
      const persistedUser = persistedMessages?.user ? toChatMessage(persistedMessages.user) : userMessage;
      const assistantMessage: ChatMessage = persistedMessages?.assistant
        ? toChatMessage(persistedMessages.assistant)
        : {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: result.narrative || result.visibleText || (result.allowed ? 'Action completed.' : 'Action blocked.'),
            createdAt: new Date().toISOString(),
          };
      setRuntimeState(nextRuntimeState as any);
      setMessages((current) => [...current.filter((message) => message.id !== userMessage.id), persistedUser, assistantMessage]);
    } catch (error: any) {
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: error.message || 'Engine action failed.',
          createdAt: new Date().toISOString(),
        },
      ]);
    }
  };

  const handleEngineAccuse = async (suspectId: string) => {
    if (!conversationId || isStreaming || !engineRuntime) return;

    const suspect = engineRuntime.blueprint.suspects.find((item) => item.id === suspectId);
    const clueIds = engineRuntime.state.discoveredClueIds;
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: `指认 ${suspect?.name || suspectId}`,
      createdAt: new Date().toISOString(),
    };

    setShouldStickToBottom(true);
    setShowJumpToBottom(false);
    forceScrollToBottomRef.current = true;
    setMessages((current) => [...current, userMessage]);

    try {
      const { result, runtimeState: nextRuntimeState, messages: persistedMessages } = await conversationsApi.engineAccuse(conversationId, suspectId, clueIds);
      const ending = engineRuntime.blueprint.endings.find((item) => item.id === result.endingId);
      const persistedUser = persistedMessages?.user ? toChatMessage(persistedMessages.user) : userMessage;
      const assistantMessage: ChatMessage = persistedMessages?.assistant
        ? toChatMessage(persistedMessages.assistant)
        : {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content:
              result.narrative ||
              ending?.description ||
              ending?.name ||
              (result.allowed
                ? result.correct ? '指认正确，案件结束。' : '指认错误，案件结束。'
                : result.blockedReasons?.join('；') || '证据不足，暂时无法做出可靠指认。'),
            createdAt: new Date().toISOString(),
          };
      setRuntimeState(nextRuntimeState as any);
      setMessages((current) => [...current.filter((message) => message.id !== userMessage.id), persistedUser, assistantMessage]);
    } catch (error: any) {
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: error.message || 'Accusation failed.',
          createdAt: new Date().toISOString(),
        },
      ]);
    }
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
      <div className="flex h-dvh items-center justify-center bg-[#19172a]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!displayAgent) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-[#19172a]">
        <p className="font-semibold text-white/54">这个世界不存在</p>
        <button
          onClick={() => router.push('/')}
          className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-[#19172a]"
        >
          返回探索
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 flex flex-col overflow-hidden bg-[#19172a] text-white lg:flex-row"
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
        onBack={() => router.back()}
        onToggleDetails={() => setDetailsOpen((value) => !value)}
        onOpenMobileDetails={() => setMobileDetailsOpen(true)}
        onCloseMobileDetails={() => setMobileDetailsOpen(false)}
        onContextMessageLimitChange={updateContextMessageLimit}
      />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Play Context Toggle - Mobile */}
        <div className="flex items-center justify-end border-b border-white/10 bg-[#19172a]/80 px-3 py-2 lg:hidden">
          <button
            onClick={() => setPlayContextOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.08] px-3 py-1.5 text-xs font-bold text-white/70"
          >
            <Compass size={13} style={{ color: categoryColor }} />
            冒险面板
          </button>
        </div>
        <div
          ref={messagesScrollRef}
          onScroll={handleMessagesScroll}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 pt-5 scroll-pb-40 sm:px-6 lg:px-10"
        >
          <div className="mx-auto max-w-4xl space-y-5">
            {!isLoggedIn && (
              <LoginRequired
                title="登录后开始冒险"
                description="登录后可以保存你的冒险记录，随时回到故事中继续探索。"
              />
            )}

            {isLoggedIn && existingConversationId && hasMoreMessages && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={loadMoreMessages}
                  disabled={loadingMoreMessages}
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-4 text-xs font-black text-white/54 transition hover:text-white disabled:text-white/30"
                >
                  {loadingMoreMessages && <Loader2 size={14} className="animate-spin" />}
                  加载更早消息
                </button>
              </div>
            )}

            {isLoggedIn && messages.length <= 1 && !isStreaming && (
              <section className="rounded-[24px] bg-white/[0.06] px-4 py-3">
                <div className="mb-3 flex items-center gap-2 text-xs font-bold text-white/40">
                  <Sparkles size={14} style={{ color: categoryColor }} />
                  你可以这样开始
                </div>
                <div className="flex flex-wrap gap-2">
                  {suggestedPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => handleSend(prompt)}
                      className="rounded-full bg-white/[0.08] px-4 py-2 text-sm font-bold leading-5 text-white/64 transition hover:-translate-y-0.5 hover:bg-white/[0.12] hover:text-white"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {isLoggedIn &&
              messages.map((message) => (
                <Fragment key={message.id}>
                  <MessageItem
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

                  {message.id === latestActionHostMessageId && (
                    <>
                      {/* Inline engine actions for blueprint-driven conversations */}
                      {engineRuntime && !isStreaming && engineActions.length > 0 && (
                        <section className="rounded-[24px] bg-white/[0.06] px-4 py-3">
                          <div className="mb-2.5 flex items-center gap-2 text-xs font-bold text-white/40">
                            <Sparkles size={14} style={{ color: categoryColor }} />
                            Engine actions
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {engineActions.map((action: any) => (
                              <button
                                key={action.id}
                                onClick={() => handleEngineAction(action.id)}
                                className="rounded-full bg-white/[0.08] px-4 py-2 text-sm font-bold leading-5 text-white/64 transition hover:-translate-y-0.5 hover:bg-white/[0.12] hover:text-white"
                              >
                                {action.label}
                              </button>
                            ))}
                          </div>
                        </section>
                      )}

                      {engineRuntime && engineCanAccuse && !isStreaming && (
                        <section className="rounded-[24px] bg-white/[0.06] px-4 py-3">
                          <div className="mb-2.5 flex items-center gap-2 text-xs font-bold text-white/40">
                            <Sparkles size={14} style={{ color: categoryColor }} />
                            Accuse
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {engineRuntime.blueprint.suspects.map((suspect) => (
                              <button
                                key={suspect.id}
                                onClick={() => handleEngineAccuse(suspect.id)}
                                className="rounded-full bg-white/[0.08] px-4 py-2 text-sm font-bold leading-5 text-white/64 transition hover:-translate-y-0.5 hover:bg-white/[0.12] hover:text-white"
                              >
                                {suspect.name}
                              </button>
                            ))}
                          </div>
                        </section>
                      )}

                      {/* Inline suggested actions for runtime-enabled conversations */}
                      {runtimeState && !engineRuntime && !isStreaming && messages.length > 1 && (() => {
                        const rawActions = runtimeState.suggestedActions?.length
                          ? runtimeState.suggestedActions
                          : [];

                        // Filter out actions that overlap with recent user messages.
                        const recentUserTexts = messages
                          .filter(m => m.role === 'user')
                          .slice(-6)
                          .map(m => m.content.toLowerCase());
                        const inlineActions = rawActions.filter(action => {
                          const actionLower = action.toLowerCase();
                          return !recentUserTexts.some(userText =>
                            userText.includes(actionLower) || actionLower.includes(userText.slice(0, 15))
                          );
                        });

                        const displayActions = inlineActions.length >= 2
                          ? inlineActions
                          : rawActions;

                        if (displayActions.length === 0) return null;

                        return (
                          <section className="rounded-[24px] bg-white/[0.06] px-4 py-3">
                            <div className="mb-2.5 flex items-center gap-2 text-xs font-bold text-white/40">
                              <Sparkles size={14} style={{ color: categoryColor }} />
                              你可以这样做
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {displayActions.map((action) => (
                                <button
                                  key={action}
                                  onClick={() => handleSend(action)}
                                  className="rounded-full bg-white/[0.08] px-4 py-2 text-sm font-bold leading-5 text-white/64 transition hover:-translate-y-0.5 hover:bg-white/[0.12] hover:text-white"
                                >
                                  {action}
                                </button>
                              ))}
                            </div>
                          </section>
                        );
                      })()}
                    </>
                  )}
                </Fragment>
              ))}

            {isLoggedIn && isStreaming && streamingContent && (
              <div className="flex justify-start gap-3">
                <Avatar src={displayAgent.avatar} alt={displayAgent.name} size="sm" className="mt-1 shrink-0" />
                <div className="min-w-0 max-w-[82%] rounded-[24px] rounded-bl-md border border-white/10 bg-[#242039] px-5 py-4 text-white/82">
                  <div className="markdown-body min-w-0 max-w-full overflow-hidden text-sm leading-7">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
                  </div>
                  <span className="ml-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-white/30" />
                </div>
              </div>
            )}

            {isLoggedIn && isStreaming && !streamingContent && (
              <div className="flex justify-start gap-3">
                <Avatar src={displayAgent.avatar} alt={displayAgent.name} size="sm" className="mt-1 shrink-0" />
                <div className="rounded-[24px] rounded-bl-md border border-white/10 bg-[#242039] px-5 py-4">
                  <div className="flex gap-1.5">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-white/30" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-white/30 [animation-delay:150ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-white/30 [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
          </div>
          {isLoggedIn && showJumpToBottom && (
            <button
              type="button"
              onClick={jumpToBottom}
              className="sticky bottom-3 left-full z-10 ml-auto mt-3 flex h-9 w-9 -translate-x-2 items-center justify-center rounded-full border border-white/10 bg-white/[0.08] text-[0px] text-white/40 backdrop-blur transition hover:bg-white/[0.12] hover:text-white"
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
          />
        )}
      </main>

      {/* Play Context Panel - Desktop toggle button */}
      {!playContextOpen && (
        <button
          onClick={() => setPlayContextOpen(true)}
          className="hidden lg:flex fixed right-4 top-20 z-20 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.08] px-3 py-2 text-xs font-bold text-white/70 transition hover:-translate-y-0.5 hover:bg-white/[0.12]"
        >
          <Compass size={14} style={{ color: categoryColor }} />
          冒险面板
        </button>
      )}

      <PlayContextPanel
        displayAgent={displayAgent}
        categoryColor={categoryColor}
        isOpen={playContextOpen}
        onClose={() => setPlayContextOpen(false)}
        messageCount={messages.length}
        runtimeState={runtimeState}
        onQuickAction={(action) => handleSend(action)}
        recentUserTexts={messages.filter(m => m.role === 'user').slice(-6).map(m => m.content)}
        actionHistory={messages.filter(m => m.role === 'user' && m.content.trim()).map(m => m.content)}
      />

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
