'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppShell from '@/components/layout/AppShell';
import LoginRequired from '@/components/auth/LoginRequired';
import ChatRoom from '@/components/chat/ChatRoom';

export default function ConversationChatPage() {
  const params = useParams();
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    setNeedsLogin(!localStorage.getItem('token'));
  }, []);

  if (needsLogin) {
    return (
      <AppShell>
        <div className="py-8">
          <LoginRequired
            title="登录后继续会话"
            description="历史会话属于你的个人空间。登录后可以继续查看上下文和接着聊天。"
          />
        </div>
      </AppShell>
    );
  }

  return <ChatRoom conversationId={params.conversationId as string} />;
}
