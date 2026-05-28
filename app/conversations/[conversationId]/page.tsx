'use client';

import { useParams } from 'next/navigation';
import ChatRoom from '@/components/chat/ChatRoom';

export default function ConversationChatPage() {
  const params = useParams();
  return <ChatRoom conversationId={params.conversationId as string} />;
}
