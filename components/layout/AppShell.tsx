'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bot, Compass, Sparkles, UserRound, MessageCircle, PanelsTopLeft } from 'lucide-react';
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
  { label: '会话', href: '/conversations', icon: MessageCircle },
];

// Module-scoped cache to retain auth status across page navigations within the session
let hasClientMounted = false;
let cachedAuthState: {
  token: string | null;
  isValid: boolean;
  checkedAt: number;
} = {
  token: null,
  isValid: false,
  checkedAt: 0,
};

let inFlightAuthPromise: Promise<boolean> | null = null;
const AUTH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

async function verifyAuth(token: string, force = false): Promise<boolean> {
  const now = Date.now();
  if (
    !force &&
    cachedAuthState.token === token &&
    cachedAuthState.isValid &&
    now - cachedAuthState.checkedAt < AUTH_CACHE_TTL_MS
  ) {
    return true;
  }

  if (inFlightAuthPromise) {
    return inFlightAuthPromise;
  }

  inFlightAuthPromise = (async () => {
    try {
      const response = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) {
        localStorage.removeItem('token');
        cachedAuthState = { token: null, isValid: false, checkedAt: Date.now() };
        return false;
      }
      const ok = response.ok;
      cachedAuthState = { token, isValid: ok, checkedAt: Date.now() };
      return ok;
    } catch {
      // Keep optimistic login state on transient network failure if previously verified
      return cachedAuthState.isValid || true;
    } finally {
      inFlightAuthPromise = null;
    }
  })();

  return inFlightAuthPromise;
}

export default function AppShell({
  children,
  mainClassName,
  hideHeader = false,
  hideBottomNav = false,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();

  // During client-side navigation (after initial mount), retain verified login status directly to prevent header flickering
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => {
    if (!hasClientMounted || typeof window === 'undefined') {
      return false;
    }
    const token = localStorage.getItem('token');
    if (!token) return false;
    if (cachedAuthState.token === token) {
      return cachedAuthState.isValid;
    }
    return Boolean(token);
  });

  useEffect(() => {
    hasClientMounted = true;
    let cancelled = false;

    const syncAuth = async (force = false) => {
      const token = localStorage.getItem('token');
      if (!token) {
        cachedAuthState = { token: null, isValid: false, checkedAt: 0 };
        if (!cancelled) setIsLoggedIn(false);
        return;
      }

      // If already verified recently and token matches, skip network request
      if (
        !force &&
        cachedAuthState.token === token &&
        cachedAuthState.isValid &&
        Date.now() - cachedAuthState.checkedAt < AUTH_CACHE_TTL_MS
      ) {
        if (!cancelled) setIsLoggedIn(true);
        return;
      }

      // Optimistically show logged in state if token exists
      if (!cancelled) {
        setIsLoggedIn(true);
      }

      const isValid = await verifyAuth(token, force);
      if (!cancelled) {
        setIsLoggedIn(isValid);
      }
    };

    const handleAuthChange = () => {
      void syncAuth(true);
    };

    window.addEventListener('storage', handleAuthChange);
    window.addEventListener('almaren-auth-change', handleAuthChange);
    void syncAuth();

    return () => {
      cancelled = true;
      window.removeEventListener('storage', handleAuthChange);
      window.removeEventListener('almaren-auth-change', handleAuthChange);
    };
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
