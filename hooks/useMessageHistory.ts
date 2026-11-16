'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject, type Dispatch, type SetStateAction } from 'react';
import { mergeMessagePage } from '@/lib/chat/message-history.mjs';

type HistoryMessage = { id: string; createdAt: string };
type MessagePage<T> = { messages: T[]; hasMore?: boolean };

// 消息行需标记 data-history-message-id，加载历史时据此保持当前可见消息的位置。
export function useMessageHistory<T extends HistoryMessage>({ scopeId, scrollRef, fetchPage, onBeforePrepend, controlledState, initialHasMore = false }: {
  scopeId: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  fetchPage: (options: { before: string; beforeId: string; signal: AbortSignal }) => Promise<MessagePage<T>>;
  onBeforePrepend: () => void;
  controlledState?: { messages: T[]; setMessages: Dispatch<SetStateAction<T[]>> };
  initialHasMore?: boolean;
}) {
  const [localMessages, setLocalMessages] = useState<T[]>([]);
  const messages = controlledState?.messages ?? localMessages;
  const setMessages = controlledState?.setMessages ?? setLocalMessages;
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const anchorRef = useRef<{ id: string; top: number } | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const resetHistory = (page: MessagePage<T>) => {
    requestRef.current?.abort();
    requestRef.current = null;
    anchorRef.current = null;
    setLoadingMoreMessages(false);
    setHistoryError('');
    setHasMoreMessages(Boolean(page.hasMore));
    setMessages(page.messages);
  };

  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    anchorRef.current = null;
    setLoadingMoreMessages(false);
    setHistoryError('');
    setHasMoreMessages(initialHasMore);
    if (!controlledState) setLocalMessages([]);
    return () => { requestRef.current?.abort(); };
  }, [scopeId]);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const container = scrollRef.current;
    if (!anchor || !container) return;
    const element = Array.from(container.querySelectorAll<HTMLElement>('[data-history-message-id]'))
      .find(node => node.dataset.historyMessageId === anchor.id);
    if (element) container.scrollTop += element.getBoundingClientRect().top - anchor.top;
    anchorRef.current = null;
  }, [messages, scrollRef]);

  const mergeLatestPage = (page: MessagePage<T>) => {
    if (!page.messages.length) {
      resetHistory(page);
      return;
    }
    setMessages(current => mergeMessagePage(current, page.messages));
  };

  const loadMoreMessages = async () => {
    const oldest = messagesRef.current[0];
    if (!oldest || !hasMoreMessages || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoadingMoreMessages(true);
    setHistoryError('');
    try {
      const page = await fetchPage({ before: oldest.createdAt, beforeId: oldest.id, signal: controller.signal });
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setHasMoreMessages(Boolean(page.hasMore));
      if (page.messages.length) {
        const container = scrollRef.current;
        const top = container?.getBoundingClientRect().top ?? 0;
        const visible = container && Array.from(container.querySelectorAll<HTMLElement>('[data-history-message-id]'))
          .find(node => node.getBoundingClientRect().bottom > top);
        anchorRef.current = visible ? { id: visible.dataset.historyMessageId!, top: visible.getBoundingClientRect().top } : null;
        onBeforePrepend();
        setMessages(current => mergeMessagePage(current, page.messages, true));
      }
    } catch (error: any) {
      if (!controller.signal.aborted) setHistoryError(error.message || '加载历史消息失败');
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoadingMoreMessages(false);
      }
    }
  };

  return { messages, setMessages, hasMoreMessages, loadingMoreMessages, historyError, resetHistory, mergeLatestPage, loadMoreMessages };
}
