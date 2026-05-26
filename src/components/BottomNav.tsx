import React from 'react';
import { MessageCircle, User as UserIcon, Settings } from 'lucide-react';
import { cn } from '../lib/utils';

export type TabType = 'chats' | 'contacts' | 'settings';

interface BottomNavProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
}

export function BottomNav({ activeTab, onChangeTab }: BottomNavProps) {
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
           "flex flex-col items-center justify-center w-full h-full transition-colors",
           activeTab === 'contacts' ? "text-black" : "text-gray-300 hover:text-gray-500"
         )}
       >
          <UserIcon size={24} className={activeTab === 'contacts' ? "fill-current" : ""} />
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
