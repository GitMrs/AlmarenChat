import React from 'react';
import { ChevronLeft, MessageSquare, Tag, User as UserIcon, Calendar, Link as LinkIcon, FileText } from 'lucide-react';
import { User } from '../types';

interface AgentDetailScreenProps {
  agentData: any;
  onClose: () => void;
  onStartChat: (agentUser: User) => void;
}

export function AgentDetailScreen({ agentData, onClose, onStartChat }: AgentDetailScreenProps) {
  const isEmoji = !agentData.meta.avatar.startsWith('http') && !agentData.meta.avatar.startsWith('/');

  // Animations states
  const [isVisible, setIsVisible] = React.useState(false);

  React.useEffect(() => {
    // trigger animation slightly after mount
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(onClose, 300); // Wait for transition
  };

  const handleStart = () => {
    setIsVisible(false);
    setTimeout(() => {
      onStartChat({
        id: `agent-${agentData.identifier}`,
        name: agentData.meta.title,
        avatar: agentData.meta.avatar,
        isOnline: true
      });
    }, 300);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div 
        className={`absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity duration-300 dark:bg-black/60 ${isVisible ? 'opacity-100' : 'opacity-0'}`} 
        onClick={handleClose}
      />
      
      {/* Drawer */}
      <div className={`relative w-full max-w-md h-full bg-white dark:bg-[#121212] shadow-2xl transition-transform duration-300 ease-in-out flex flex-col ${isVisible ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* App Bar */}
        <div className="flex items-center px-4 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
          <button 
            onClick={handleClose}
            className="p-2 -ml-2 text-gray-500 hover:text-black dark:text-gray-400 dark:hover:text-white transition-colors rounded-full hover:bg-gray-50 dark:hover:bg-gray-800 mr-2"
          >
            <ChevronLeft size={24} />
          </button>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Agent Details</h2>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto w-full px-6 py-10">
          <div className="flex flex-col items-center text-center mb-10">
            <div className="relative mb-6">
              {isEmoji ? (
                <div className="w-28 h-28 rounded-3xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-5xl shadow-sm border border-gray-200 dark:border-gray-700">
                  {agentData.meta.avatar}
                </div>
              ) : (
                <img 
                  src={agentData.meta.avatar} 
                  alt={agentData.meta.title} 
                  className="w-28 h-28 rounded-3xl object-cover shadow-sm border border-gray-200 dark:border-gray-700"
                />
              )}
              <div className="absolute -bottom-2 -right-2 bg-black text-white dark:bg-white dark:text-black text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-lg">
                {agentData.meta.category || 'Bot'}
              </div>
            </div>
            
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2 tracking-tight">{agentData.meta.title}</h1>
            <p className="text-[15px] leading-relaxed text-gray-500 dark:text-gray-400 mb-6">{agentData.meta.description}</p>
            
            <button 
              onClick={handleStart}
              className="flex w-full items-center justify-center gap-2 bg-black dark:bg-white text-white dark:text-black px-6 py-3.5 rounded-xl font-medium text-[15px] hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors active:scale-[0.98] shadow-[0_4px_12px_rgba(0,0,0,0.1)] dark:shadow-[0_4px_12px_rgba(255,255,255,0.1)]"
            >
              <MessageSquare size={18} />
              Start Chat
            </button>
          </div>

          <div className="space-y-6 pb-8">
            {agentData.description && (
              <div>
                <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <FileText size={12} /> System Instructions
                </h3>
                <div className="bg-gray-50 dark:bg-[#1a1a1a] p-3.5 rounded-2xl border border-gray-100 dark:border-gray-800">
                  <p className="text-[13px] text-gray-600 dark:text-gray-300 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                    {agentData.description}
                  </p>
                </div>
              </div>
            )}

            <div>
              <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                <Tag size={12} /> Skills & Tags
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {agentData.meta.tags.map((tag: string) => (
                  <span key={tag} className="px-2.5 py-1 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-md text-[11px] font-medium text-gray-600 dark:text-gray-400">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="bg-gray-50 dark:bg-[#1a1a1a] p-3.5 rounded-2xl border border-gray-100 dark:border-gray-800 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-white dark:bg-black flex items-center justify-center shadow-sm text-gray-400 dark:text-gray-500 border border-gray-50 dark:border-gray-900">
                  <UserIcon size={16} />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-0.5">Author</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{agentData.author}</p>
                </div>
              </div>
              
              <div className="bg-gray-50 dark:bg-[#1a1a1a] p-3.5 rounded-2xl border border-gray-100 dark:border-gray-800 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-white dark:bg-black flex items-center justify-center shadow-sm text-gray-400 dark:text-gray-500 border border-gray-50 dark:border-gray-900">
                  <Calendar size={16} />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-0.5">Created At</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{agentData.createdAt}</p>
                </div>
              </div>
              
              {agentData.homepage && (
                <div className="bg-gray-50 dark:bg-[#1a1a1a] p-3.5 rounded-2xl border border-gray-100 dark:border-gray-800 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-white dark:bg-black flex items-center justify-center shadow-sm text-gray-400 dark:text-gray-500 border border-gray-50 dark:border-gray-900">
                    <LinkIcon size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-0.5">Homepage</p>
                    <a href={agentData.homepage} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-blue-600 dark:text-blue-400 truncate block hover:underline">
                      {agentData.homepage}
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
