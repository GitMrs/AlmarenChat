'use client';

import { memo } from 'react';
import MessageActions from '@/components/chat/MessageActions';
import MessageBubbleFrame from '@/components/chat/MessageBubbleFrame';
import MessageContent from '@/components/chat/MessageContent';
import type { MessageAttachment } from '@/types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: MessageAttachment[];
  createdAt: string;
}

export type DisplayAgent = {
  id: string;
  name: string;
  avatar?: string;
  description?: string;
  category?: string;
  tone?: string;
  greeting?: string;
  systemPrompt?: string;
};

type MessageItemProps = {
  message: ChatMessage;
  displayAgent: DisplayAgent;
  categoryColor: string;
  latestAssistantMessageId?: string;
  copiedId: string | null;
  activeActionMessageId: string | null;
  onActivate: (id: string) => void;
  onCopy: (id: string, content: string) => void;
  onRegenerate: () => void;
  onDelete: (message: ChatMessage) => void;
};

export const MessageItem = memo(function MessageItem({
  message,
  displayAgent,
  categoryColor,
  latestAssistantMessageId,
  copiedId,
  activeActionMessageId,
  onActivate,
  onCopy,
  onRegenerate,
  onDelete,
}: MessageItemProps) {
  return (
    <MessageBubbleFrame
      role={message.role}
      avatar={displayAgent.avatar}
      agentName={displayAgent.name}
      userColor={categoryColor}
      showAvatar={message.role === 'assistant'}
      onActivate={() => onActivate(message.id)}
      footer={message.id !== 'greeting' ? (
        <MessageActions
          role={message.role}
          createdAt={message.createdAt}
          copied={copiedId === message.id}
          active={activeActionMessageId === message.id}
          canRegenerate={message.id === latestAssistantMessageId}
          onCopy={() => onCopy(message.id, message.content)}
          onRegenerate={onRegenerate}
          onDelete={() => onDelete(message)}
        />
      ) : null}
    >
      <MessageContent
        role={message.role}
        content={message.content}
        attachments={message.attachments}
        shouldAutoCollapse={message.id !== latestAssistantMessageId && message.id !== 'greeting'}
      />
    </MessageBubbleFrame>
  );
});
