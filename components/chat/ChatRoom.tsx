'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, Flame, Loader2, Sparkles, Trash2 } from 'lucide-react';
import TrendingTopicPicker from '@/components/trending/TrendingTopicPicker';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Avatar from '@/components/shared/Avatar';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import TextInputDialog from '@/components/shared/TextInputDialog';
import LoginRequired from '@/components/auth/LoginRequired';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import AgentDetailsPanel from '@/components/chat/AgentDetailsPanel';
import CompanionPreview from '@/components/companion/CompanionPreview';
import type { CompanionSkin } from '@/lib/companion/catalog';
import ChatComposer from '@/components/chat/ChatComposer';
import { MessageItem } from '@/components/chat/ChatMessageItem';
import MessageReasoning from '@/components/chat/MessageReasoning';
import AgentContextModal from '@/components/chat/AgentContextModal';
import { getMessageReasoning } from '@/lib/chat/reasoning.mjs';
import MemorySuggestionDialog, { type MemorySuggestion } from '@/components/chat/MemorySuggestionDialog';
import { useTTS } from '@/hooks/useTTS';
import { getBuiltInAgents } from '@/lib/agents/data/agents-data';
import { getCompanionCharacterId } from '@/lib/companion/agents';
import { companionReplyInstruction, createCompanionReplyParser } from '@/lib/companion/reply-protocol.mjs';
import type { CompanionReply } from '@/lib/companion/reply';
import type { AgentDailyStudyRecord, AgentStudyItem } from '@/lib/agent-study/types';
import { agentMemories, generateConversationImage, streamChat, conversations as conversationsApi, agents as agentsApi, user as userApi, uploads } from '@/lib/client/api';
import {
  DEFAULT_BROWSER_MODEL_CONFIG,
  readBrowserModelConfigForScope,
  saveBrowserModelConfig,
  streamBrowserModel,
} from '@/lib/web/browser-model';
import { cn } from '@/lib/client/utils';
import { CATEGORY_COLORS } from '@/types';
import type { Agent, MessageAttachment } from '@/types';
import type { ChatMessage, DisplayAgent } from '@/components/chat/ChatMessageItem';
import type { BrowserModelConfig, BrowserModelSource } from '@/lib/web/browser-model';
import { shouldExtractMemorySuggestion } from '@/lib/personal-assistant/memory-intent.mjs';
import { isWorldEventAgent, resolveWorldEventQuery, WORLD_EVENTS_UNAVAILABLE_CONTEXT } from '@/lib/world/agent-policy';
import { formatKnowledgeContext } from '@/lib/knowledge/context';

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
const LARGE_PASTE_TEXT_LIMIT = 2000;
const LARGE_PASTE_LINES_LIMIT = 30;

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
  const viewParam = searchParams.get('view');
  const viewMode = viewParam === 'companion' ? 'companion' : 'chat';

  const [agent, setAgent] = useState<Agent | null>(null);
  const [conversationAgent, setConversationAgent] = useState<DisplayAgent | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [companionDraft, setCompanionDraft] = useState('');
  const [companionSkinPrompt, setCompanionSkinPrompt] = useState('');
  const [companionReply, setCompanionReply] = useState<CompanionReply | null>(null);
  const activeViewRef = useRef(viewMode);
  activeViewRef.current = viewMode;
  const activeChatRef = useRef('');
  activeChatRef.current = `${agentId}:${existingConversationId || ''}`;
  const replyRequestRef = useRef(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationMode, setConversationMode] = useState<'MAIN' | 'TEMPORARY'>('MAIN');
  const [temporaryConversations, setTemporaryConversations] = useState<{ id: string; title?: string | null; archived: boolean }[]>([]);
  const [renameConversationTarget, setRenameConversationTarget] = useState<{ id: string; title: string } | null>(null);
  const [renamingConversation, setRenamingConversation] = useState(false);
  const [pendingMemorySuggestions, setPendingMemorySuggestions] = useState<{ agentId: string; conversationId: string; suggestions: MemorySuggestion[]; selected: Set<number> } | null>(null);
  const [savingMemorySuggestions, setSavingMemorySuggestions] = useState(false);
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<ChatMessage | null>(null);
  const [pendingDeleteConversation, setPendingDeleteConversation] = useState<{ id: string; title: string } | null>(null);
  const [pendingArchiveConversation, setPendingArchiveConversation] = useState<{ id: string; title: string } | null>(null);
  const [archivingConversation, setArchivingConversation] = useState(false);
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
  const [needsLogin, setNeedsLogin] = useState(false);
  const [contextMessageLimit, setContextMessageLimit] = useState(DEFAULT_CONTEXT_MESSAGE_LIMIT);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [viewportOffsetTop, setViewportOffsetTop] = useState(0);
  const [pendingAttachment, setPendingAttachment] = useState<MessageAttachment | null>(null);
  const [pendingLargeTextMeta, setPendingLargeTextMeta] = useState<{ chars: number; kind: 'json' | 'text' } | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [webStatus, setWebStatus] = useState('');
  const [chatMode, setChatMode] = useState<'chat' | 'image'>('chat');
  const [trendingPickerOpen, setTrendingPickerOpen] = useState(false);
  const [quickTopics, setQuickTopics] = useState<{ id: string; source: string; sourceName: string; title: string; heat?: string }[]>([]);
  const [dailyStudy, setDailyStudy] = useState<AgentDailyStudyRecord | null>(null);
  const [loadingDailyStudy, setLoadingDailyStudy] = useState(false);
  const [studyEnabled, setStudyEnabled] = useState(false);
  const [studySourceMode, setStudySourceMode] = useState<'internal' | 'bilibili'>('internal');

  const agentCategoryKey = useMemo(() => {
    const rawCat = (conversationAgent?.category || agent?.category || '').toLowerCase();
    const desc = (conversationAgent?.description || agent?.description || '').toLowerCase();
    const combined = `${rawCat} ${desc}`;
    if (combined.includes('游戏') || combined.includes('动漫') || combined.includes('二次元') || combined.includes('原神')) return 'anime';
    if (combined.includes('编程') || combined.includes('代码') || combined.includes('开发') || combined.includes('前端') || combined.includes('后端') || combined.includes('技术') || combined.includes('工具')) return 'dev';
    if (combined.includes('商业') || combined.includes('财经') || combined.includes('创投') || combined.includes('科技')) return 'tech';
    if (combined.includes('书') || combined.includes('电影') || combined.includes('文化') || combined.includes('心理')) return 'culture';
    return 'hot';
  }, [conversationAgent?.category, conversationAgent?.description, agent?.category, agent?.description]);

  useEffect(() => {
    if (!agent && !conversationAgent) return;
    fetch(`/api/trending?category=${agentCategoryKey}&limit=3`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          const list: { id: string; source: string; sourceName: string; title: string; heat?: string }[] = [];
          for (const src of res.data) {
            if (Array.isArray(src.items)) {
              for (const it of src.items) {
                list.push({
                  id: it.id,
                  source: it.source || src.source,
                  sourceName: it.sourceName || src.sourceName,
                  title: it.title,
                  heat: it.heat,
                });
                if (list.length >= 3) break;
              }
            }
            if (list.length >= 3) break;
          }
          setQuickTopics(list);
        }
      })
      .catch(() => {});
  }, [agentCategoryKey, agent?.id, conversationAgent?.id]);
  const [browserModelConfig, setBrowserModelConfig] = useState<BrowserModelConfig>({ ...DEFAULT_BROWSER_MODEL_CONFIG });
  const [modelSource, setModelSource] = useState<BrowserModelSource>('ONLINE');
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const [shouldStickToBottom, setShouldStickToBottom] = useState(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const pendingPrependScrollRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);

  const { play: playTTS, stop: stopTTS, isPlaying: isTTSPlaying, isLoading: isTTSLoading, currentId: currentTTSId } = useTTS();

  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const forceScrollToBottomRef = useRef(false);
  const pendingLargeTextRef = useRef<string | null>(null);
  const isComposingRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const config = readBrowserModelConfigForScope('GLOBAL');
    setBrowserModelConfig(config);
    setModelSource(config.source);
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

  const loadDailyStudy = async (targetAgentId: string, refresh = false) => {
    if (!targetAgentId) return;
    try {
      setLoadingDailyStudy(true);
      const res = await agentsApi.dailyStudy(targetAgentId, { refresh });
      setStudyEnabled(Boolean(res?.enabled));
      if (res?.sourceMode) setStudySourceMode(res.sourceMode);
      setDailyStudy(res?.study || null);
    } catch (err) {
      console.warn('[ChatRoom] loadDailyStudy failed:', err);
    } finally {
      setLoadingDailyStudy(false);
    }
  };

  const handleToggleStudyEnabled = async (enabled: boolean) => {
    const targetAgentId = conversationAgent?.id || agent?.id || agentId;
    if (!targetAgentId) return;
    try {
      setLoadingDailyStudy(true);
      const res = await agentsApi.setDailyStudyEnabled(targetAgentId, enabled);
      setStudyEnabled(Boolean(res?.enabled));
      setDailyStudy(res?.study || null);
    } catch (err) {
      console.warn('[ChatRoom] setDailyStudyEnabled failed:', err);
    } finally {
      setLoadingDailyStudy(false);
    }
  };

  const handleChangeStudySourceMode = async (mode: 'internal' | 'bilibili') => {
    const targetAgentId = conversationAgent?.id || agent?.id || agentId;
    if (!targetAgentId) return;
    try {
      setStudySourceMode(mode);
      await agentsApi.setDailyStudySourceMode(targetAgentId, mode);
    } catch (err) {
      console.warn('[ChatRoom] setDailyStudySourceMode failed:', err);
    }
  };

  const handleDiscussStudyItem = (item: AgentStudyItem) => {
    const text = `我看你今天看了《${item.title}》，你有什么想跟我聊聊的吗？`;
    setDraft(text);
    const targetAgentId = conversationAgent?.id || agent?.id || agentId;
    if (targetAgentId) {
      agentsApi.markDailyStudyShared(targetAgentId).catch(() => {});
    }
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  useEffect(() => {
    const loadAgent = async () => {
      try {
        if (!localStorage.getItem('token')) {
          setNeedsLogin(true);
          return;
        }

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
        let authenticated = false;
        try {
          const { user: u } = await userApi.get();
          authenticated = true;
          setIsLoggedIn(true);
          setContextMessageLimit(Math.max(1, Math.min(MAX_CONTEXT_MESSAGE_LIMIT, u.contextMessageLimit || DEFAULT_CONTEXT_MESSAGE_LIMIT)));
          setUserSettings({
            ...(u.customModelEnabled && u.apiBaseUrl && u.apiKey && u.modelName
              ? { apiBaseUrl: u.apiBaseUrl, apiKey: u.apiKey, modelName: u.modelName }
              : {}),
            imageGenerationAvailable: Boolean(u.imageModelEnabled && (u.imageApiBaseUrl || u.apiBaseUrl) && (u.imageApiKey || u.apiKey) && u.imageModelName),
            imageModelSize: u.imageModelSize || '1024x1024',
          });
        } catch (err: any) {
          if (err?.status === 401 || err?.message === 'Unauthorized' || !localStorage.getItem('token')) {
            setNeedsLogin(true);
            return;
          }
        }

        // Agent chat uses one persistent main conversation per user and agent.
        const mainConversation = !existingConversationId && found && authenticated
          ? (await agentsApi.getMainConversation(found.id).catch(() => null))?.conversation
          : null;
        const activeConversationId = existingConversationId || mainConversation?.id || null;

        if (activeConversationId) {
          setConversationId(activeConversationId);
          try {
            const { conversation } = mainConversation
              ? { conversation: mainConversation }
              : await conversationsApi.get(activeConversationId);
            setConversationAgent({
              id: conversation.agentId || agentId || existingConversationId,
              name: conversation.agentName || found?.name || '未知 Agent',
              avatar: conversation.agentAvatar || found?.avatar,
              description: conversation.agentDescription || found?.description,
              category: conversation.agentCategory || found?.category,
              themeColor: found?.themeColor || (conversation as any).agentThemeColor,
              tone: conversation.agentTone || found?.tone,
              systemPrompt: conversation.agentSystemPrompt || found?.systemPrompt,
              greeting: found?.greeting,
              voice: (conversation as any).agentVoice || found?.voice,
              companionCharacterId: found?.companionCharacterId || getCompanionCharacterId(conversation.agentId),
            });
            setConversationMode((conversation as any).agentMode === 'TEMPORARY' ? 'TEMPORARY' : 'MAIN');
            const conversationList = await conversationsApi.list({ agentId: conversation.agentId || agentId, limit: 100, includeLastMessage: false, includeArchived: true }).catch(() => ({ conversations: [] }));
            setTemporaryConversations(
              conversationList.conversations
                .filter((item: any) => item.agentMode === 'TEMPORARY')
                .map((item: any) => ({ id: item.id, title: item.title, archived: Boolean(item.archived) }))
            );
            setContextMessageLimit(
              Math.max(
                1,
                Math.min(
                  MAX_CONTEXT_MESSAGE_LIMIT,
                  conversation.contextMessageLimit || contextMessageLimit || DEFAULT_CONTEXT_MESSAGE_LIMIT
                )
              )
            );

            const { messages: existingMessages, hasMore } = await conversationsApi.getMessages(activeConversationId, {
              limit: MESSAGE_PAGE_SIZE,
            });
            setShouldStickToBottom(true);
            setShowJumpToBottom(false);
            forceScrollToBottomRef.current = true;
            setHasMoreMessages(Boolean(hasMore));
            setMessages(
              existingMessages.filter((msg: any) => !(msg.role === 'assistant' && !String(msg.content || '').trim() && !getMessageReasoning(msg.attachments))).map((msg: any) => ({
                id: msg.id,
                role: msg.role,
                content: msg.content,
                attachments: msg.attachments || [],
                reasoning: getMessageReasoning(msg.attachments),
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

        const targetAgentId = found?.id || agentId;
        if (targetAgentId && authenticated) {
          loadDailyStudy(targetAgentId);
        }
      } finally {
        setLoading(false);
      }
    };

    loadAgent();
  }, [agentId, existingConversationId]);

  const openMainConversation = () => {
    const targetAgentId = conversationAgent?.id || agent?.id || agentId;
    if (!targetAgentId || conversationMode === 'MAIN') return;
    router.replace(`/chat/${targetAgentId}`);
  };

  const createTemporaryConversation = async () => {
    if (!isLoggedIn || !displayAgent || isStreaming) return;

    try {
      const created = await conversationsApi.create({
        agentId: displayAgent.id || agentId,
        title: `${displayAgent.name}的临时聊天`,
        agentSnapshot: displayAgent,
      });
      router.push(`/conversations/${created.conversation.id}`);
    } catch (error) {
      console.error('Create temporary conversation failed:', error);
    }
  };

  const selectConversation = (targetConversationId: string) => {
    router.replace(`/conversations/${targetConversationId}`);
  };

  const archiveConversation = async (targetConversationId: string, archived: boolean) => {
    if (archived) {
      const target = temporaryConversations.find((item) => item.id === targetConversationId);
      setPendingArchiveConversation({ id: targetConversationId, title: target?.title || '临时聊天' });
      return;
    }
    await conversationsApi.update(targetConversationId, { archived });
    if (targetConversationId === conversationId) {
      router.replace(`/chat/${conversationAgent?.id || agent?.id || agentId}`);
    } else {
      setTemporaryConversations((items) => items.map((item) => item.id === targetConversationId ? { ...item, archived } : item));
    }
  };

  const confirmArchiveConversation = async () => {
    if (!pendingArchiveConversation || archivingConversation) return;
    setArchivingConversation(true);
    try {
      const { id } = pendingArchiveConversation;
      await conversationsApi.update(id, { archived: true });
      setPendingArchiveConversation(null);
      if (id === conversationId) {
        router.replace(`/chat/${conversationAgent?.id || agent?.id || agentId}`);
      } else {
        setTemporaryConversations((items) => items.map((item) => item.id === id ? { ...item, archived: true } : item));
      }
    } finally {
      setArchivingConversation(false);
    }
  };

  const deleteConversation = async (targetConversationId: string) => {
    const target = temporaryConversations.find((item) => item.id === targetConversationId);
    setPendingDeleteConversation({ id: targetConversationId, title: target?.title || '临时聊天' });
  };

  const confirmDeleteConversation = async () => {
    if (!pendingDeleteConversation) return;
    const { id } = pendingDeleteConversation;
    await conversationsApi.delete(id);
    setPendingDeleteConversation(null);
    if (id === conversationId) {
      router.replace(`/chat/${conversationAgent?.id || agent?.id || agentId}`);
    } else {
      setTemporaryConversations((items) => items.filter((item) => item.id !== id));
    }
  };

  const renameConversation = async (targetConversationId: string) => {
    const current = temporaryConversations.find((item) => item.id === targetConversationId);
    setRenameConversationTarget({ id: targetConversationId, title: current?.title || '临时聊天' });
  };

  const submitConversationRename = async (title: string) => {
    if (!renameConversationTarget || renamingConversation) return;
    setRenamingConversation(true);
    try {
      const { id } = renameConversationTarget;
      await conversationsApi.update(id, { title });
      setTemporaryConversations((items) => items.map((item) => item.id === id ? { ...item, title } : item));
      setRenameConversationTarget(null);
    } finally {
      setRenamingConversation(false);
    }
  };

  const extractAgentMemorySuggestions = async (userMessage: string, assistantMessage: string, targetConversationId: string) => {
    if (conversationMode !== 'MAIN' || !displayAgent?.id || !shouldExtractMemorySuggestion(userMessage)) return;
    const requestChat = activeChatRef.current;
    const payload = { mode: 'single' as const, userMessage, assistantMessage, conversationId: targetConversationId, agentId: displayAgent.id };
    let result;
    if (modelSource !== 'OLLAMA') {
      result = await agentMemories.extract(displayAgent.id, payload);
    } else {
      const prepared = await agentMemories.extract(displayAgent.id, { ...payload, localOnly: true });
      if (!prepared.modelMessages?.length) return;
      const stream = await streamBrowserModel({ config: { ...browserModelConfig, source: modelSource }, messages: prepared.modelMessages });
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let localResponse = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        localResponse += decoder.decode(value, { stream: true });
      }
      result = await agentMemories.extract(displayAgent.id, { ...payload, localResponse });
    }
    if (result.suggestions?.length && requestChat === activeChatRef.current) {
      setPendingMemorySuggestions({ agentId: displayAgent.id, conversationId: targetConversationId, suggestions: result.suggestions, selected: new Set(result.suggestions.map((_, index) => index)) });
    }
  };

  const saveMemorySuggestions = async () => {
    if (conversationMode !== 'MAIN' || !pendingMemorySuggestions || pendingMemorySuggestions.conversationId !== conversationId || !displayAgent?.id || savingMemorySuggestions) return;
    setSavingMemorySuggestions(true);
    try {
      await Promise.all([...pendingMemorySuggestions.selected].map((index) => {
        const suggestion = pendingMemorySuggestions.suggestions[index];
        return agentMemories.add(pendingMemorySuggestions.agentId, { content: suggestion.content, category: suggestion.category, conversationId: pendingMemorySuggestions.conversationId });
      }));
      setPendingMemorySuggestions(null);
    } finally {
      setSavingMemorySuggestions(false);
    }
  };

  useEffect(() => {
    if (isLoggedIn && initialPrompt && agent && messages.length <= 1 && !existingConversationId) {
      handleSend(initialPrompt);
    }
  }, [isLoggedIn, initialPrompt, agent, existingConversationId, messages.length]);

  useEffect(() => {
    setActiveActionMessageId(null);
  }, [messages.length]);

  const displayAgent = conversationAgent || agent;
  const companionCharacterId = displayAgent?.companionCharacterId || agent?.companionCharacterId || getCompanionCharacterId(displayAgent?.id || agentId);

  useEffect(() => {
    replyRequestRef.current++;
    isComposingRef.current = false;
    setCompanionReply(null);
    stopTTS();
  }, [viewMode, agentId, existingConversationId, stopTTS]);

  useEffect(() => {
    setDraft('');
    setCompanionDraft('');
  }, [agentId, existingConversationId]);

  const toggleCompanionView = () => {
    const nextView = viewMode === 'companion' ? 'chat' : 'companion';
    const params = new URLSearchParams(searchParams.toString());
    if (nextView === 'companion') {
      params.set('view', 'companion');
    } else {
      params.delete('view');
    }
    const queryString = params.toString();
    const basePath = routeConversationId
      ? `/conversations/${routeConversationId}`
      : `/chat/${agentId || displayAgent?.id || 'companion-nari'}`;
    router.replace(queryString ? `${basePath}?${queryString}` : basePath);
  };

  const categoryColor = displayAgent?.themeColor || agent?.themeColor || (displayAgent ? CATEGORY_COLORS[displayAgent.category || ''] || '#6366f1' : '#6366f1');
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
  }, [messages.length, streamingContent, streamingReasoning, isStreaming, shouldStickToBottom, viewportHeight, viewportOffsetTop]);

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
    reasoning: getMessageReasoning(msg.attachments),
    createdAt: msg.createdAt,
  });

  const syncConversationMessages = async (id: string, localPendingMessages: ChatMessage[] = []) => {
    const { messages: latestMessages, hasMore } = await conversationsApi.getMessages(id, { limit: MESSAGE_PAGE_SIZE });
    setHasMoreMessages(Boolean(hasMore));
    const serverMessages = latestMessages.filter((message: any) => !(message.role === 'assistant' && !String(message.content || '').trim() && !getMessageReasoning(message.attachments))).map(toChatMessage);
    const serverMessageKeys = new Set(
      serverMessages.map((message) => `${message.role}|${message.content}|${message.attachments?.map((attachment) => attachment.url).filter(Boolean).join(',') || ''}`)
    );
    const pendingMessages = localPendingMessages.filter((message) => {
      if (!message.id.startsWith('user-') && !message.id.startsWith('assistant-') && !message.id.startsWith('error-')) return false;
      const key = `${message.role}|${message.content}|${message.attachments?.map((attachment) => attachment.url).filter(Boolean).join(',') || ''}`;
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
          reasoning: getMessageReasoning(msg.attachments),
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
      if (isComposingRef.current) return;
      const text = event.clipboardData.getData('text');
      if (text.length <= LARGE_PASTE_TEXT_LIMIT && text.split('\n').length <= LARGE_PASTE_LINES_LIMIT) return;

      event.preventDefault();
      pendingLargeTextRef.current = text;
      setPendingLargeTextMeta({ chars: text.length, kind: getLargeTextKind(text) });
      setDraft('');
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
    const isCompanionSend = viewMode === 'companion' && Boolean(companionCharacterId);
    if (!isCompanionSend && isComposingRef.current) return;
    if (!isLoggedIn) {
      router.push('/login');
      return;
    }

    const content = text ?? (isCompanionSend ? companionDraft.trim() : pendingLargeTextRef.current ?? draft.trim());
    const outgoingAttachments = isCompanionSend ? [] : options.attachmentsOverride || (pendingAttachment ? [pendingAttachment] : []);
    const requestMode = isCompanionSend ? 'chat' : options.modeOverride || chatMode;
    if (requestMode === 'image' && outgoingAttachments.length > 0) return;
    if ((!content && outgoingAttachments.length === 0) || isStreaming || (!isCompanionSend && uploadingImage)) return;
    const replyRequest = ++replyRequestRef.current;
    const requestChat = activeChatRef.current;

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
      if (isCompanionSend) {
        if (text === undefined || text === companionDraft.trim()) setCompanionDraft('');
      } else if (text === undefined) {
        setDraft('');
      }
      if (!isCompanionSend) {
        pendingLargeTextRef.current = null;
        setPendingLargeTextMeta(null);
        setPendingAttachment(null);
        setUploadError('');
      }
    }
    setCompanionReply(null);
    stopTTS();
    setIsStreaming(true);
    setStreamingContent('');
    setStreamingReasoning('');
    setWebStatus('');

    let fullReasoning = '';
    const onReasoning = (text: string) => {
      if (abortRef.current?.signal.aborted) return;
      fullReasoning += text;
      setStreamingReasoning(fullReasoning);
    };
    try {
      const historySource = options.historyOverride || nextLocalMessages;
      const history = historySource.filter(message => message.role !== 'assistant' || message.content.trim()).map((message) => ({
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
            voice: displayAgent.voice,
          }
        : undefined;
      const usesBrowserModel = modelSource === 'OLLAMA';
      let replyEmotion = 'calm';
      const activeBrowserModelConfig = { ...browserModelConfig, source: modelSource };
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

        let localConversationId = conversationId || undefined;
        if (!localConversationId) {
          const created = await conversationsApi.create({
            agentId: displayAgent?.id || agentId,
            title: content.slice(0, 50) || (outgoingAttachments.length > 0 ? '图片会话' : '新会话'),
            agentSnapshot,
          });
          localConversationId = created.conversation.id;
          setConversationId(localConversationId);
          await conversationsApi.update(localConversationId, { contextMessageLimit });
        }

        if (!options.reuseLastUserMessage) {
          await conversationsApi.sendMessage(localConversationId, content, {
            role: 'user',
            attachments: outgoingAttachments,
          });
        }

        const memoryState = conversationMode === 'MAIN'
          ? await agentMemories.context(displayAgent?.id || agentId, localConversationId, content, controller.signal)
          : { context: '', archivedThrough: null };
        const archivedThrough = memoryState.archivedThrough;
        const modelMessages: { role: 'system' | 'user' | 'assistant'; content: any }[] = historySource
          .filter((message) => !message.id.startsWith('error-') && (message.role !== 'assistant' || message.content.trim()))
          .filter(message => !archivedThrough || new Date(message.createdAt).getTime() > new Date(archivedThrough.createdAt).getTime() || (new Date(message.createdAt).getTime() === new Date(archivedThrough.createdAt).getTime() && message.id > archivedThrough.id))
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
        let worldContext = '';
        if (isWorldEventAgent(displayAgent?.id || agentId) && resolveWorldEventQuery(content, history)) {
          try {
            worldContext = (await conversationsApi.worldContext(localConversationId, content, controller.signal)).context;
          } catch (error) {
            if (controller.signal.aborted) throw error;
            worldContext = WORLD_EVENTS_UNAVAILABLE_CONTEXT;
          }
        }
        const memoryContext = memoryState.context;
        let knowledgeContext = '';
        if (content.trim()) {
          try {
            const { hits } = await agentsApi.searchKnowledge(displayAgent?.id || agentId, content, controller.signal);
            knowledgeContext = formatKnowledgeContext(hits.filter((hit) => hit.score >= 0.35), { scopeLabel: '角色专属知识库' });
          } catch (error) {
            if (controller.signal.aborted) throw error;
            console.warn('[chat/knowledge] Knowledge hit retrieval failed:', error);
          }
        }
        const companionSkinInstruction = isCompanionSend && companionSkinPrompt
          ? `当前换装的皮肤对话规则（只影响表达氛围，不改变核心人格）：${companionSkinPrompt}\n请在自然相关的回复中适度融入这些元素，偶尔使用对应意象或小口头禅即可；不要每句话都重复皮肤关键词，也不要把服装设定说成角色身份发生了改变。`
          : '';
        const systemPrompt = [displayAgent?.systemPrompt, memoryContext, knowledgeContext, worldContext, isCompanionSend ? companionReplyInstruction : '', companionSkinInstruction].filter(Boolean).join('\n\n');
        if (systemPrompt) {
          modelMessages.unshift({ role: 'system', content: systemPrompt });
        }

        result = {
          stream: await streamBrowserModel({
            config: activeBrowserModelConfig,
            messages: modelMessages,
            signal: controller.signal,
            onReasoning,
          }),
          conversationId: localConversationId,
        };
      } else {
        result = await streamChat({
          message: content,
          history,
          context: [
            displayAgent?.systemPrompt,
            isCompanionSend && companionSkinPrompt
              ? `当前换装的皮肤对话规则（只影响表达氛围，不改变核心人格）：${companionSkinPrompt}\n请在自然相关的回复中适度融入这些元素，偶尔使用对应意象或小口头禅即可；不要每句话都重复皮肤关键词，也不要把服装设定说成角色身份发生了改变。`
              : '',
          ].filter(Boolean).join('\n\n'),
          conversationId: conversationId || undefined,
          agentId: displayAgent?.id || agentId,
          attachments: outgoingAttachments,
          contextMessageLimit,
          skipPersistUserMessage: options.reuseLastUserMessage,
          onStatus: setWebStatus,
          knowledgeEnabled: true,
          companionMode: isCompanionSend,
          onCompanionCue: (emotion) => { replyEmotion = emotion; },
          onReasoning,
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
      const replyParser = usesBrowserModel && isCompanionSend ? createCompanionReplyParser() : null;
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullContent += replyParser ? replyParser.push(chunk) : chunk;
        setStreamingContent(fullContent);
      }
      const tail = decoder.decode();
      fullContent += replyParser ? replyParser.push(tail) + replyParser.finish() : tail;
      if (replyParser) replyEmotion = replyParser.emotion;

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: fullContent,
        reasoning: fullReasoning,
        createdAt: new Date().toISOString(),
      };

      const messagesWithAssistant = [...messagesRef.current, assistantMessage];
      messagesRef.current = messagesWithAssistant;
      setMessages(messagesWithAssistant);
      setIsStreaming(false);
      setStreamingContent('');

      if (result.conversationId) {
        if (usesBrowserModel && fullContent) {
          await conversationsApi.sendMessage(result.conversationId, fullContent, { role: 'assistant', reasoning: fullReasoning });
        }
        if (isCompanionSend && activeViewRef.current === 'companion' && requestChat === activeChatRef.current && replyRequest === replyRequestRef.current && !controller.signal.aborted && fullContent.trim()) {
          setCompanionReply({ id: assistantMessage.id, content: fullContent, emotion: replyEmotion });
        }
        await syncConversationMessages(result.conversationId, messagesWithAssistant);
        if (fullContent && content) {
          extractAgentMemorySuggestions(content, fullContent, result.conversationId).catch(() => {});
        }
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
            reasoning: fullReasoning,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    } finally {
      setIsStreaming(false);
      setStreamingReasoning('');
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    if (streamingContent || streamingReasoning) {
      if (modelSource === 'OLLAMA' && conversationId) {
        conversationsApi.sendMessage(conversationId, streamingContent, { role: 'assistant', reasoning: streamingReasoning }).catch(() => {});
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: streamingContent,
          reasoning: streamingReasoning,
          createdAt: new Date().toISOString(),
        },
      ]);
      setStreamingContent('');
      setStreamingReasoning('');
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
    if (conversationId) {
      await conversationsApi.update(conversationId, { contextMessageLimit: nextLimit });
    }
    setContextMessageLimit(nextLimit);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
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
    }, 260);
  };

  const updateComposerValue = (value: string) => {
    if (value.length > LARGE_PASTE_TEXT_LIMIT) {
      pendingLargeTextRef.current = value;
      setPendingLargeTextMeta({ chars: value.length, kind: getLargeTextKind(value) });
      setDraft('');
      return;
    }
    setDraft(value);
    if (!pendingLargeTextRef.current) return;
    if (value.trim() === '') return;
    pendingLargeTextRef.current = null;
    setPendingLargeTextMeta(null);
  };

  const handleComposerInput = (event: React.FormEvent<HTMLTextAreaElement>) => {
    const value = event.currentTarget.value;
    if (isComposingRef.current || (event.nativeEvent as InputEvent).isComposing) {
      setDraft(value);
      return;
    }
    updateComposerValue(value);
  };

  if (needsLogin) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[#fbfaf7] p-4 sm:p-6">
        <div className="w-full max-w-lg">
          <LoginRequired
            title="登录后开启对话"
            description="聊天与 Agent 记忆需要绑定个人账号。登录后即可开始深度交流，并持久化保存你的对话与专属记忆。"
          />
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => router.push('/')}
              className="text-xs font-bold text-slate-500 underline underline-offset-4 transition hover:text-slate-800"
            >
              返回发现页
            </button>
          </div>
        </div>
      </div>
    );
  }

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
      {conversationMode === 'MAIN' && pendingMemorySuggestions && pendingMemorySuggestions.agentId === displayAgent?.id && pendingMemorySuggestions.conversationId === conversationId && (
        <MemorySuggestionDialog
          suggestions={pendingMemorySuggestions.suggestions}
          selected={pendingMemorySuggestions.selected}
          loading={savingMemorySuggestions}
          onToggle={(index) => setPendingMemorySuggestions((current) => {
            if (!current) return current;
            const selected = new Set(current.selected);
            if (selected.has(index)) selected.delete(index);
            else selected.add(index);
            return { ...current, selected };
          })}
          onCancel={() => setPendingMemorySuggestions(null)}
          onConfirm={saveMemorySuggestions}
        />
      )}
      <TextInputDialog
        open={Boolean(renameConversationTarget)}
        title="重命名聊天"
        label="聊天名称"
        defaultValue={renameConversationTarget?.title || ''}
        placeholder="输入聊天名称"
        loading={renamingConversation}
        onCancel={() => setRenameConversationTarget(null)}
        onConfirm={submitConversationRename}
      />
      <AgentDetailsPanel
        displayAgent={displayAgent}
        categoryColor={categoryColor}
        detailsOpen={detailsOpen}
        mobileDetailsOpen={mobileDetailsOpen}
        isLoggedIn={isLoggedIn}
        onBack={() => router.back()}
        onToggleDetails={() => setDetailsOpen((value) => !value)}
        onOpenMobileDetails={() => setMobileDetailsOpen(true)}
        onCloseMobileDetails={() => setMobileDetailsOpen(false)}
        conversationMode={conversationMode}
        onOpenMainConversation={openMainConversation}
        onCreateTemporaryConversation={createTemporaryConversation}
        temporaryConversations={temporaryConversations}
        onSelectConversation={selectConversation}
        onArchiveConversation={archiveConversation}
        onDeleteConversation={deleteConversation}
        onRenameConversation={renameConversation}
        viewMode={viewMode}
        onToggleCompanionView={companionCharacterId ? toggleCompanionView : undefined}
        dailyStudy={dailyStudy}
        loadingDailyStudy={loadingDailyStudy}
        studyEnabled={studyEnabled}
        onToggleStudyEnabled={handleToggleStudyEnabled}
        studySourceMode={studySourceMode}
        onChangeStudySourceMode={handleChangeStudySourceMode}
        onRefreshDailyStudy={() => displayAgent?.id && loadDailyStudy(displayAgent.id, true)}
        onDiscussDailyStudy={handleDiscussStudyItem}
      />

      {viewMode === 'companion' && companionCharacterId ? (
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {(pendingAttachment || pendingLargeTextMeta || uploadingImage) && (
            <div className="shrink-0 bg-amber-50 px-4 py-2 text-xs text-amber-900" role="status">
              文字模式中的待发送附件或长文本已保留。
              <button type="button" className="ml-2 underline" onClick={toggleCompanionView}>返回处理</button>
            </div>
          )}
          <CompanionPreview
            characterId={companionCharacterId}
            embedded
            onBackToChat={toggleCompanionView}
            onCompanionSkinChange={(skin: CompanionSkin) => setCompanionSkinPrompt(skin.interaction?.promptHint || '')}
            externalMessages={messages}
            onSendMessage={async (text) => {
              await handleSend(text);
            }}
            isStreaming={isStreaming}
            streamingContent={streamingContent}
            streamingReasoning={streamingReasoning}
            onOpenContext={() => setContextOpen(true)}
            draftValue={companionDraft}
            onDraftChange={setCompanionDraft}
            reply={companionReply}
            voice={displayAgent?.voice}
          />
        </div>
      ) : (
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
                  speakingId={isTTSPlaying ? currentTTSId : null}
                  speakingLoadingId={isTTSLoading ? currentTTSId : null}
                  onActivate={(id) => setActiveActionMessageId((current) => (current === id ? null : id))}
                  onCopy={handleCopy}
                  onRegenerate={handleRegenerate}
                  onDelete={setPendingDeleteMessage}
                  onSpeak={(id, content) => {
                    const voice = displayAgent?.voice || undefined;
                    playTTS(content, { id, voice });
                  }}
                />
              ))}
            {isLoggedIn && isStreaming && webStatus && <div className="text-xs text-slate-500" role="status">{webStatus}</div>}
            {isLoggedIn && isStreaming && (streamingContent || streamingReasoning) && (
              <div className="flex justify-start gap-3">
                <Avatar src={displayAgent.avatar} alt={displayAgent.name} size="sm" className="mt-1 shrink-0" />
                <div className="min-w-0 max-w-[82%] rounded-[24px] rounded-bl-md border border-black/[0.06] bg-white px-5 py-4 text-slate-800 shadow-sm">
                  <MessageReasoning reasoning={streamingReasoning} thinking={!streamingContent} />
                  {streamingContent && (
                    <div className="markdown-body min-w-0 max-w-full overflow-hidden text-sm leading-7">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
                    </div>
                  )}
                  {streamingContent && <span className="ml-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-slate-300" />}
                </div>
              </div>
            )}

            {isLoggedIn && isStreaming && !streamingContent && !streamingReasoning && (
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
            draftValue={draft}
            fileInputRef={fileInputRef}
            onImageSelect={handleImageSelect}
            onPaste={handlePaste}
            onInput={handleComposerInput}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={event => {
              isComposingRef.current = false;
              updateComposerValue(event.currentTarget.value);
            }}
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
            mode={chatMode}
            onOpenTrending={() => setTrendingPickerOpen(true)}
            onOpenContext={() => setContextOpen(true)}
            onClearMessages={() => setConfirmClearOpen(true)}
            canClearMessages={messages.length > 0}
            imageGenerationAvailable={Boolean(userSettings?.imageGenerationAvailable) && modelSource !== 'OLLAMA'}
            modelSource={modelSource}
            ollamaAvailable={Boolean(browserModelConfig.baseUrl && browserModelConfig.model)}
            onModelSourceChange={(source) => {
              const nextConfig = saveBrowserModelConfig({ ...browserModelConfig, source }, 'GLOBAL');
              setBrowserModelConfig(nextConfig);
              setModelSource(nextConfig.source);
              if (source === 'OLLAMA') {
                setChatMode('chat');
              }
            }}
            onModeChange={(mode) => {
              setChatMode(mode);
            }}
          />
        )}
      </main>
      )}
      {contextOpen && isLoggedIn && (
        <AgentContextModal key={`${displayAgent.id}:${conversationId || 'new'}`} agentId={displayAgent.id} agentName={displayAgent.name} conversationId={conversationId} conversationMode={conversationMode} contextMessageLimit={contextMessageLimit} maxContextMessageLimit={MAX_CONTEXT_MESSAGE_LIMIT} onContextMessageLimitChange={updateContextMessageLimit} onClose={() => setContextOpen(false)} />
      )}
      <ConfirmDialog
        open={confirmClearOpen}
        title="清空当前聊天消息？"
        description={conversationMode === 'MAIN'
          ? '原始消息将被删除，无法恢复。个人记忆、知识库、活动记录与对话归档仍会保留；如需遗忘，请到对应入口单独管理。'
          : '当前聊天的原始消息将被删除，无法恢复。个人记忆、知识库和活动记录不受影响。'}
        icon={<Trash2 size={20} />}
        cancelText="先保留"
        confirmText="确认清空"
        destructive
        loading={clearingMessages}
        onCancel={() => setConfirmClearOpen(false)}
        onConfirm={handleClearMessages}
      />
      <ConfirmDialog
        open={Boolean(pendingArchiveConversation)}
        title="归档这个临时聊天？"
        description={`${pendingArchiveConversation?.title || '临时聊天'}将从当前列表隐藏，但之后仍可在“已归档”中恢复。`}
        cancelText="先保留"
        confirmText="确认归档"
        loading={archivingConversation}
        onCancel={() => setPendingArchiveConversation(null)}
        onConfirm={confirmArchiveConversation}
      />
      <TrendingTopicPicker
        isOpen={trendingPickerOpen}
        onClose={() => setTrendingPickerOpen(false)}
        onSelectTopic={(prompt) => handleSend(prompt)}
        agentName={conversationAgent?.name || agent?.name}
        mode="chat"
      />
      <ConfirmDialog
        open={Boolean(pendingDeleteConversation)}
        title="永久删除这个临时聊天？"
        description={`${pendingDeleteConversation?.title || '临时聊天'}及其消息将被永久删除，无法恢复。`}
        icon={<Trash2 size={20} />}
        cancelText="先保留"
        confirmText="确认删除"
        destructive
        onCancel={() => setPendingDeleteConversation(null)}
        onConfirm={confirmDeleteConversation}
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
