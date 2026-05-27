'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bot, Compass, Plus, Settings, Sparkles, UserRound } from 'lucide-react';
import BottomNav from './BottomNav';
import { cn } from '@/lib/utils';

interface AppShellProps {
  children: React.ReactNode;
}

const navItems = [
  { label: '发现', href: '/', icon: Compass },
  { label: '广场', href: '/agents', icon: Bot },
  { label: '创建', href: '/create-agent', icon: Plus },
  { label: '我的', href: '/me', icon: UserRound },
  { label: '设置', href: '/settings', icon: Settings },
];

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen bg-[#fbfaf7] text-slate-950">
      <header className="sticky top-0 z-40 border-b border-black/[0.06] bg-[#fbfaf7]/88 backdrop-blur-xl">
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

          <Link
            href="/login"
            className="hidden rounded-full border border-black/[0.06] bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:text-slate-950 md:block"
          >
            登录 / 注册
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 pb-24 sm:px-6 lg:px-8">{children}</main>
      <BottomNav />
    </div>
  );
}
