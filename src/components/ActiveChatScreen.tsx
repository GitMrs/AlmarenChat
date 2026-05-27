import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { ChevronLeft, Trash2, Smile, Plus, Image as ImageIcon, Camera, Phone, File, Wallet, ArrowRightLeft, Bookmark, SendHorizontal, ChevronDown } from 'lucide-react';
import Markdown from 'react-markdown';
import { Chat, Message } from '../types';
import { cn } from '../lib/utils';
import { useVirtualizer } from '@tanstack/react-virtual';

interface ActiveChatScreenProps {
  chat: Chat;
  messages: Message[];
  onBack: () => void;
  isMobile: boolean;
  onSendMessage: (text: string) => void;
  onClearChat?: () => void;
  currentUserId?: string;
  onTyping?: () => void;
  onStopTyping?: () => void;
  isOtherTyping?: boolean;
}

export function ActiveChatScreen({
  chat, messages, onBack, isMobile, onSendMessage, onClearChat,
  currentUserId, onTyping, onStopTyping, isOtherTyping
}: ActiveChatScreenProps) {
  const [inputText, setInputText] = useState('');
  const [showAttachments, setShowAttachments] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const parentRef = useRef<HTMLDivElement>(null);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = target;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 200;
    setShowScrollBottom(!isNearBottom);
  };

  const scrollToBottom = () => {
    if (messages.length > 0) {
      rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
    }
  };

  useLayoutEffect(() => {
    if (parentRef.current && messages.length > 0) {
       parentRef.current.scrollTop = parentRef.current.scrollHeight;
    }
  }, [messages.length]);

  // Handle input change with typing indicator
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);

    if (onTyping) {
      onTyping();
      // Clear existing timer
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      // Auto-stop typing after 2 seconds of inactivity
      typingTimerRef.current = setTimeout(() => {
        onStopTyping?.();
      }, 2000);
    }
  };

  const handleSend = () => {
    if (inputText.trim()) {
      onSendMessage(inputText.trim());
      setInputText('');
      onStopTyping?.();
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    }
  };

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 20,
    measureElement: (element) => {
        if (!element) return 60;
        return element.getBoundingClientRect().height;
    }
  });

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
          <div className="relative">
            {chat.user.avatar.startsWith('http') || chat.user.avatar.startsWith('/') ? (
              <img
                src={chat.user.avatar}
                alt={chat.user.name}
                className="w-10 h-10 rounded-xl object-cover"
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-lg">
                {chat.user.avatar}
              </div>
            )}
            {chat.user.isOnline && (
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white"></div>
            )}
          </div>
          <div className="ml-3">
            <h2 className="font-semibold text-[15px] text-gray-900 leading-tight tracking-tight">
              {chat.user.name}
            </h2>
            <p className={cn(
              "text-[11px] font-medium leading-tight",
              isOtherTyping ? "text-blue-500" : chat.user.isOnline ? "text-green-500" : "text-gray-400"
            )}>
              {isOtherTyping ? 'typing...' : chat.user.isOnline ? 'Online' : 'Offline'}
            </p>
          </div>
        </div>
        {onClearChat && (
          <button
            className="p-2 text-gray-700 hover:text-red-500 transition-colors"
            onClick={onClearChat}
            title="Clear Chat"
          >
            <Trash2 size={22} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {/* Message List (Virtualized) */}
      <div
        ref={parentRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4"
        style={{ scrollBehavior: 'auto' }}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const msg = messages[virtualRow.index];
            const isMe = msg.senderId === currentUserId;

            return (
              <div
                key={msg.id}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className={cn(
                  "flex pb-4",
                  isMe ? "justify-end" : "justify-start"
                )}
              >
                 <div className={cn(
                   "max-w-[75%] rounded-2xl px-4 py-2.5",
                   isMe
                    ? "bg-[#e2e8f0] text-gray-900 rounded-br-sm"
                    : "bg-white text-gray-900 border border-gray-100 rounded-bl-sm"
                 )}>
                    {msg.type === 'image' && msg.imageUrls && (
                       <div className="flex flex-col gap-2 mb-1">
                          {msg.imageUrls.map((url, i) => (
                             <img
                                key={i}
                                src={url}
                                alt="attachment"
                                className="rounded-xl max-w-full h-auto object-cover max-h-[300px]"
                                loading="lazy"
                             />
                          ))}
                       </div>
                    )}
                    {msg.isTyping && (
                       <div className="flex space-x-1.5 mt-1 mb-1 items-center justify-center h-4 px-2">
                         <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                         <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                         <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                       </div>
                    )}
                    {(!msg.isTyping && msg.content && msg.content !== "Sent an image" && msg.content !== "Sent images") && (
                       <div className="flex items-end gap-2">
                         <div className={cn("text-[15px] leading-relaxed [&>p:not(:last-child)]:mb-2 markdown-body", msg.type==='image' && 'mt-2 text-sm')}>
                           {isMe ? msg.content : <Markdown>{msg.content}</Markdown>}
                         </div>
                         {isMe && msg.status && !chat.user.id.startsWith('agent-') && (
                           <span className={cn(
                             "text-[10px] shrink-0 pb-0.5",
                             msg.status === 'read' ? "text-blue-500" : "text-gray-400"
                           )}>
                             {msg.status === 'read' ? '✓✓' : msg.status === 'delivered' ? '✓✓' : '✓'}
                           </span>
                         )}
                       </div>
                    )}
                 </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative w-full z-30 animate-in fade-in duration-200">
         {showScrollBottom && (
            <button
               onClick={scrollToBottom}
               className="absolute right-4 -top-16 w-10 h-10 bg-white border border-gray-100 shadow-[0_5px_15px_rgba(0,0,0,0.1)] rounded-full flex items-center justify-center text-gray-500 hover:text-gray-900 transition-colors dark:bg-[#1e2329] dark:border-gray-800 dark:text-gray-300 animate-in fade-in zoom-in-95"
            >
               <ChevronDown size={24} />
            </button>
         )}
      </div>

      {/* Input Area */}
      <div className="bg-white px-4 py-3 border-t border-gray-50 pb-env-safe rounded-t-3xl shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.05)] z-20">
        <div className="flex items-center gap-3">
          <button className="text-gray-900 hover:opacity-70 transition-opacity">
            <Smile size={24} strokeWidth={2.5} />
          </button>
          <div className="flex-1 bg-gray-50 rounded-2xl flex items-center px-4 h-12">
            <input
              type="text"
              placeholder=" "
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                 if (e.key === 'Enter') handleSend();
              }}
              className="w-full bg-transparent border-none outline-none text-gray-900 placeholder-gray-400"
            />
          </div>
          {inputText.trim() ? (
            <button
               onClick={handleSend}
               className="w-10 h-10 flex items-center justify-center bg-[#1e2329] text-white rounded-xl hover:bg-black transition-colors shrink-0"
            >
              <SendHorizontal size={20} strokeWidth={2} />
            </button>
          ) : (
            <button
               onClick={() => setShowAttachments(!showAttachments)}
               className="text-gray-900 hover:opacity-70 transition-opacity p-1 -mr-1"
            >
              <Plus size={28} strokeWidth={2.5} />
            </button>
          )}
        </div>

         {showAttachments && (
            <div className="grid grid-cols-4 gap-y-6 gap-x-2 pt-6 pb-4 animate-in slide-in-from-bottom-4 duration-200 fade-in">
               {[
                  { icon: ImageIcon, label: 'Album' },
                  { icon: Camera, label: 'Camera' },
                  { icon: Phone, label: 'Call' },
                  { icon: File, label: 'File' },
                  { icon: Wallet, label: 'Wallet' },
                  { icon: ArrowRightLeft, label: 'Transfer' },
                  { icon: Bookmark, label: 'Collect' },
               ].map((item, i) => (
                  <div key={i} className="flex flex-col items-center gap-2 cursor-pointer group">
                     <div className="w-14 h-14 rounded-2xl bg-white border border-gray-100 flex items-center justify-center text-gray-700 group-hover:bg-gray-50 transition-colors shadow-sm">
                        <item.icon size={22} strokeWidth={2} />
                     </div>
                     <span className="text-[11px] font-medium text-gray-500">{item.label}</span>
                  </div>
               ))}
            </div>
         )}
      </div>
    </div>
  );
}
