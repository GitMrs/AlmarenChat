'use client';

import { useRouter } from 'next/navigation';
import { BookOpen } from 'lucide-react';
import AppShell from '@/components/layout/AppShell';
import EmptyState from '@/components/shared/EmptyState';

export default function MyAgentsPage() {
  const router = useRouter();

  return (
    <AppShell>
      <div className="pb-20 md:pb-0">
        <div className="px-6 py-6">
          <h1 className="text-xl font-bold text-gray-900 mb-6">我的世界</h1>
          <EmptyState
            icon={BookOpen}
            title="还没有创作世界"
            description="创建一个故事世界，邀请玩家来探索和冒险"
            action={{
              label: '创作世界',
              onClick: () => router.push('/create-agent'),
            }}
          />
        </div>
      </div>
    </AppShell>
  );
}
