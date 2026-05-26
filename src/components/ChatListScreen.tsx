import React, { useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { Chat } from '../types';
import { format, isToday, isYesterday } from 'date-fns';
import { cn } from '../lib/utils';

interface ChatListScreenProps {
  chats: Chat[];
  onSelectChat: (chat: Chat) => void;
  activeChatId?: string;
  onDeleteChat?: (chatId: string) => void;
}

function formatRelativeTime(dateString: string) {
  const date = new Date(dateString);
  if (isToday(date)) {
    return format(date, 'HH:mm aaa').toLowerCase().replace(' am', ' am').replace(' pm', ' pm'); // Approximate format '15 min ago' vs exact time
  } else if (isYesterday(date)) {
    return 'Yesterday';
  } else {
    return format(date, 'MMM d');
  }
}

export function ChatListScreen({ chats, onSelectChat, activeChatId, onDeleteChat }: ChatListScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredChats = chats.filter(chat => 
    chat.user.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    chat.lastMessage.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-white relative">
      {/* App Bar */}
      <div className="flex flex-col px-6 pt-6 pb-2 gap-4">
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight dark:text-gray-100">Chats</h1>
        
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
            <Search size={18} className="text-gray-400" />
          </div>
          <input 
            type="text" 
            placeholder="Search messages or users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-transparent rounded-xl outline-none focus:bg-white focus:border-gray-200 focus:ring-4 focus:ring-gray-50 transition-all text-sm text-gray-900 placeholder:text-gray-400 dark:bg-[#1e2329] dark:focus:bg-[#1e2329] dark:focus:border-gray-700 dark:text-white dark:focus:ring-gray-800"
          />
        </div>
      </div>

      {/* Chat List */}
      <div className="flex-1 overflow-y-auto px-4 pb-24 pt-2">
        {filteredChats.length === 0 ? (
          <div className="text-center text-gray-500 py-10 text-sm">No chats found.</div>
        ) : (
          filteredChats.map((chat) => (
          <div 
            key={chat.id} 
            onClick={() => onSelectChat(chat)}
            className={cn(
              "flex items-center p-3 rounded-2xl cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors mb-1 select-none group relative",
              activeChatId === chat.id && "bg-gray-100 dark:bg-gray-800" // For desktop split view highlight
            )}
          >
            {/* Avatar */}
            <div className="relative flex-shrink-0 mr-4">
              {chat.user.avatar.startsWith('http') || chat.user.avatar.startsWith('/') ? (
                <img 
                  src={chat.user.avatar} 
                  alt={chat.user.name} 
                  className="w-12 h-12 rounded-xl object-cover"
                />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xl">
                  {chat.user.avatar}
                </div>
              )}
              {chat.user.isOnline && (
                <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-white"></div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-baseline mb-0.5">
                <h3 className="font-semibold text-[15px] text-gray-900 truncate">
                  {chat.user.name}
                </h3>
                <span className="text-[11px] text-gray-400 whitespace-nowrap ml-2 font-medium">
                  {formatRelativeTime(chat.lastMessage.timestamp)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <p className="text-[13px] text-gray-400 truncate pr-2 group-hover:pr-8 transition-all">
                  {chat.lastMessage.content}
                </p>
                <div className="flex items-center">
                  {chat.unreadCount > 0 && (
                    <div className="bg-[#2c2f33] text-white text-[10px] font-bold px-1.5 min-w-[20px] h-5 flex items-center justify-center rounded pl-1.5 pr-1.5 ml-1 group-hover:hidden">
                      {chat.unreadCount}
                    </div>
                  )}
                  {onDeleteChat && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteChat(chat.id);
                      }}
                      className="hidden group-hover:flex items-center justify-center p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors ml-1"
                      title="Delete Chat"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )))}
      </div>

    </div>
  );
}
