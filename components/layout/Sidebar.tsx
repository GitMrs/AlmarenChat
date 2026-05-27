'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Compass, Bot, PlusCircle, MessageSquare, Settings, Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

const navItems = [
  { id: 'discover', label: '发现', icon: Compass, href: '/' },
  { id: 'agents', label: 'Agent 广场', icon: Bot, href: '/agents' },
  { id: 'create', label: '创建 Agent', icon: PlusCircle, href: '/create-agent' },
  { id: 'conversations', label: '对话历史', icon: MessageSquare, href: '/conversations' },
  { id: 'settings', label: '设置', icon: Settings, href: '/settings' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col bg-white border-r border-gray-100 h-screen flex-shrink-0 transition-all duration-300 relative',
        collapsed ? 'w-[72px]' : 'w-[220px]'
      )}
    >
      {/* Logo */}
      <div className={cn('flex items-center gap-3 px-5 py-5', collapsed && 'justify-center px-0')}>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-sm shadow-primary-200 flex-shrink-0">
          <Sparkles size={18} className="text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <span className="text-base font-bold text-gray-900 tracking-tight block">AlmarenChat</span>
            <p className="text-[10px] text-gray-400 -mt-0.5">AI Agent Platform</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-2 space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <button
              key={item.id}
              onClick={() => router.push(item.href)}
              title={collapsed ? item.label : undefined}
              className={cn(
                'w-full flex items-center gap-3 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer',
                collapsed ? 'justify-center px-0 py-2.5' : 'px-3.5 py-2.5',
                active
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
              )}
            >
              <Icon size={18} strokeWidth={active ? 2.2 : 1.8} className="flex-shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-white border border-gray-200 rounded-full flex items-center justify-center cursor-pointer hover:bg-gray-50 shadow-sm z-10 transition-colors duration-200"
      >
        {collapsed ? <ChevronRight size={12} className="text-gray-500" /> : <ChevronLeft size={12} className="text-gray-500" />}
      </button>

      {/* Footer */}
      {!collapsed && (
        <div className="px-4 py-4 border-t border-gray-50">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50/80">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center text-xs font-bold text-gray-500 flex-shrink-0">
              U
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-700 truncate">未登录</p>
              <p className="text-[11px] text-gray-400">点击登录</p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
