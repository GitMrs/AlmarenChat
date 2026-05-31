'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Compass, Globe, MessageCircle, Plus, Sparkles, UserRound } from 'lucide-react';

import BottomNav from './BottomNav';
import { cn } from '@/lib/utils';

interface AppShellProps {
  children: React.ReactNode;
}

const navItems = [
  { label: '发现', href: '/', icon: Compass },
  { label: '探索', href: '/agents', icon: Globe },
  { label: '创建', href: '/create-agent', icon: Plus },
  { label: '游玩', href: '/conversations', icon: MessageCircle },
];

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    setIsLoggedIn(!!localStorage.getItem('token'));
  }, []);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen bg-[#19172a] text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#19172a]/88 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-[#d89022] shadow-sm">
              <Sparkles size={18} />
            </div>
            <div>
              <div className="text-sm font-bold leading-tight text-white">AlmarenChat</div>
              <div className="text-xs text-white/48">可玩的故事世界</div>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/[0.08] p-1 shadow-sm md:flex">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition',
                    active
                      ? 'bg-white text-[#19172a] shadow-sm'
                      : 'text-white/62 hover:bg-white/10 hover:text-white'
                  )}
                >
                  <Icon size={16} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {isLoggedIn ? (
            <button
              onClick={() => router.push('/me')}
              className="hidden h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white shadow-sm transition hover:bg-white/16 md:flex"
              aria-label="个人中心"
            >
              <UserRound size={18} />
            </button>
          ) : (
            <Link
              href="/login"
              className="hidden rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-white/16 md:block"
            >
              登录 / 注册
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 pb-24 sm:px-6 lg:px-8">{children}</main>
      <BottomNav variant="story" />
    </div>
  );
}
