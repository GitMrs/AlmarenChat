'use client';

import { useRouter } from 'next/navigation';
import { Bot } from 'lucide-react';
import AppShell from '@/components/layout/AppShell';
import EmptyState from '@/components/shared/EmptyState';

export default function MyAgentsPage() {
  const router = useRouter();

  return (
    <AppShell>
      <div className="pb-20 md:pb-0">
        <div className="px-6 py-6">
          <h1 className="text-xl font-bold text-gray-900 mb-6">我的 Agent</h1>
          <EmptyState
            icon={Bot}
            title="还没有创建 Agent"
            description="创建你的专属 AI 角色，开始个性化聊天体验"
            action={{
              label: '创建 Agent',
              onClick: () => router.push('/create-agent'),
            }}
          />
        </div>
      </div>
    </AppShell>
  );
}
