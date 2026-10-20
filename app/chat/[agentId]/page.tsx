'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppShell from '@/components/layout/AppShell';
import LoginRequired from '@/components/auth/LoginRequired';
import ChatRoom from '@/components/chat/ChatRoom';

export default function ChatPage() {
  const params = useParams();
  const [checking, setChecking] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('token')) {
      setNeedsLogin(true);
    }
    setChecking(false);
  }, []);

  if (checking) {
    return null;
  }

  if (needsLogin) {
    return (
      <AppShell>
        <div className="py-8">
          <LoginRequired
            title="登录后开启对话"
            description="聊天与 Agent 记忆需要绑定个人账号。登录后即可开始深度交流，并持久化保存你的对话与专属记忆。"
          />
        </div>
      </AppShell>
    );
  }

  return <ChatRoom agentId={params.agentId as string} />;
}

