'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Compass, Globe, MessageCircle, PlusCircle, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BottomNavProps {
  variant?: 'default' | 'story';
}

const tabs = [
  { id: 'discover', label: '发现', icon: Compass, href: '/' },
  { id: 'explore', label: '探索', icon: Globe, href: '/agents' },
  { id: 'create', label: '创建', icon: PlusCircle, href: '/create-agent' },
  { id: 'play', label: '游玩', icon: MessageCircle, href: '/conversations' },
  { id: 'me', label: '我的', icon: UserRound, href: '/me' },
];

export default function BottomNav({ variant = 'default' }: BottomNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isStory = variant === 'story';

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <nav
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 border-t backdrop-blur-xl md:hidden',
        isStory ? 'border-white/10 bg-[#19172a]/94' : 'border-black/[0.06] bg-white/92'
      )}
    >
      <div className="flex h-[68px] items-center justify-around">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab.href);

          return (
            <button
              key={tab.id}
              onClick={() => router.push(tab.href)}
              className={cn(
                'relative flex h-full flex-1 flex-col items-center justify-center gap-1 text-[10px] font-semibold transition',
                isStory
                  ? active
                    ? 'text-white'
                    : 'text-white/42'
                  : active
                    ? 'text-slate-950'
                    : 'text-slate-400'
              )}
            >
              {active && (
                <div className={cn('absolute top-2 h-1 w-1 rounded-full', isStory ? 'bg-[#d89022]' : 'bg-slate-950')} />
              )}
              <Icon size={20} strokeWidth={active ? 2.4 : 1.8} />
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
