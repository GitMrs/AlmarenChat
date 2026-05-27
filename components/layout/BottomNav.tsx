'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Bot, Compass, PlusCircle, Settings, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabs = [
  { id: 'discover', label: '发现', icon: Compass, href: '/' },
  { id: 'agents', label: '广场', icon: Bot, href: '/agents' },
  { id: 'create', label: '创建', icon: PlusCircle, href: '/create-agent' },
  { id: 'me', label: '我的', icon: UserRound, href: '/me' },
  { id: 'settings', label: '设置', icon: Settings, href: '/settings' },
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-black/[0.06] bg-white/92 backdrop-blur-xl md:hidden">
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
                active ? 'text-slate-950' : 'text-slate-400'
              )}
            >
              {active && <div className="absolute top-2 h-1 w-1 rounded-full bg-slate-950" />}
              <Icon size={20} strokeWidth={active ? 2.4 : 1.8} />
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
