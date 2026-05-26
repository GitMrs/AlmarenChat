import React from 'react';
import { ChevronLeft, MessageCircle, Phone, Video, MoreHorizontal } from 'lucide-react';
import { User } from '../types';

interface UserDetailScreenProps {
  user: User;
  onBack: () => void;
  onMessage: (user: User) => void;
  isMobile: boolean;
}

export function UserDetailScreen({ user, onBack, onMessage, isMobile }: UserDetailScreenProps) {
  return (
    <div className="flex flex-col h-full bg-white relative">
      {/* App Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white/90 backdrop-blur z-10">
        <div className="flex items-center">
          {isMobile && (
             <button onClick={onBack} className="mr-3 p-1 -ml-1 text-gray-700 hover:text-black">
               <ChevronLeft size={28} strokeWidth={2} />
             </button>
          )}
        </div>
        <button className="p-2 text-gray-700 hover:text-black">
          <MoreHorizontal size={24} strokeWidth={2} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-24 flex flex-col items-center pt-12 px-6">
        <div className="relative mb-6">
          {user.avatar.startsWith('http') || user.avatar.startsWith('/') ? (
            <img 
              src={user.avatar} 
              alt={user.name} 
              className="w-32 h-32 rounded-3xl object-cover shadow-md"
            />
          ) : (
            <div className="w-32 h-32 rounded-3xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-6xl shadow-md">
              {user.avatar}
            </div>
          )}
          {user.isOnline && (
            <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-green-500 rounded-full border-4 border-white"></div>
          )}
        </div>

        <h2 className="text-3xl font-bold text-gray-900 tracking-tight mb-2">
          {user.name}
        </h2>
        <p className="text-sm font-medium text-gray-500 mb-8">
          {user.isOnline ? 'Online now' : 'Last seen recently'}
        </p>

        <div className="flex justify-center w-full max-w-xs">
          <button 
            onClick={() => onMessage(user)}
            className="w-full flex items-center justify-center gap-3 bg-[#1e2329] text-white py-3.5 rounded-2xl hover:bg-black transition-colors"
          >
             <MessageCircle size={22} />
             <span className="text-sm font-medium">Message</span>
          </button>
        </div>
      </div>
    </div>
  );
}
