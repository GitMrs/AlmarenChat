'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bot, Compass, Plus, Sparkles, UserRound, MessageCircle, PanelsTopLeft } from 'lucide-react';
import BottomNav from './BottomNav';
import { cn } from '@/lib/utils';

interface AppShellProps {
  children: React.ReactNode;
  mainClassName?: string;
  hideHeader?: boolean;
  hideBottomNav?: boolean;
}

const navItems = [
  { label: '发现', href: '/', icon: Compass },
  { label: '广场', href: '/agents', icon: Bot },
  { label: '空间', href: '/spaces', icon: PanelsTopLeft },
  { label: '创建', href: '/create-agent', icon: Plus },
  { label: '会话', href: '/conversations', icon: MessageCircle },
];

export default function AppShell({
  children,
  mainClassName,
  hideHeader = false,
  hideBottomNav = false,
}: AppShellProps) {
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
    <div className="min-h-screen bg-[#fbfaf7] text-slate-950">
      {!hideHeader && <header className="sticky top-0 z-40 border-b border-black/[0.06] bg-[#fbfaf7]/88 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-sm">
              <Sparkles size={18} />
            </div>
            <div>
              <div className="text-sm font-bold leading-tight">AlmarenChat</div>
              <div className="text-xs text-slate-500">AI Agent Universe</div>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 rounded-full border border-black/[0.06] bg-white/75 p-1 shadow-sm md:flex">
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
                      ? 'bg-slate-950 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
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
              className="hidden h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-white shadow-sm md:flex"
            >
              <UserRound size={18} />
            </button>
          ) : (
            <Link
              href="/login"
              className="hidden rounded-full border border-black/[0.06] bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:text-slate-950 md:block"
            >
              登录 / 注册
            </Link>
          )}
        </div>
      </header>}

      <main className={cn('mx-auto w-full max-w-7xl px-4 pb-24 sm:px-6 lg:px-8', mainClassName)}>{children}</main>
      {!hideBottomNav && <BottomNav />}
    </div>
  );
}
