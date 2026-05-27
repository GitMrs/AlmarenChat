import React from 'react';
import { MessageCircle, User as UserIcon, Settings } from 'lucide-react';
import { cn } from '../lib/utils';

export type TabType = 'chats' | 'contacts' | 'settings';

interface BottomNavProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
  friendRequestCount?: number;
}

export function BottomNav({ activeTab, onChangeTab, friendRequestCount = 0 }: BottomNavProps) {
  return (
    <div className="absolute bottom-0 inset-x-0 h-16 bg-white/[0.98] backdrop-blur border-t border-gray-100 flex items-center justify-around px-6 z-10 pb-env-safe">
       <button
         onClick={() => onChangeTab('chats')}
         className={cn(
           "flex flex-col items-center justify-center w-full h-full transition-colors",
           activeTab === 'chats' ? "text-black" : "text-gray-300 hover:text-gray-500"
         )}
       >
          <MessageCircle size={24} className={activeTab === 'chats' ? "fill-black" : ""} />
       </button>
       <button
         onClick={() => onChangeTab('contacts')}
         className={cn(
           "flex flex-col items-center justify-center w-full h-full relative transition-colors",
           activeTab === 'contacts' ? "text-black" : "text-gray-300 hover:text-gray-500"
         )}
       >
          <UserIcon size={24} className={activeTab === 'contacts' ? "fill-current" : ""} />
          {friendRequestCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {friendRequestCount > 9 ? '9+' : friendRequestCount}
            </span>
          )}
       </button>
       <button
         onClick={() => onChangeTab('settings')}
         className={cn(
           "flex flex-col items-center justify-center w-full h-full transition-colors",
           activeTab === 'settings' ? "text-black" : "text-gray-300 hover:text-gray-500"
         )}
       >
          <Settings size={24} strokeWidth={2.5} />
       </button>
    </div>
  );
}
