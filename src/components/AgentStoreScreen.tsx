import React, { useState } from 'react';
import { Bot, ChevronLeft, Trash2, Plus, Search } from 'lucide-react';
import { User } from '../types';
import agentData from '../lib/agent.json';

interface AgentStoreScreenProps {
  onClose: () => void;
  agents: User[];
  onSelectStoreAgent: (agentData: any) => void;
  onCreateCustomAgent: () => void;
  onDeleteAgent: (id: string) => void;
}

export function AgentStoreScreen({ onClose, agents, onSelectStoreAgent, onCreateCustomAgent, onDeleteAgent }: AgentStoreScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  const categories = ['All', ...Array.from(new Set(agentData.map(a => a.meta.category))).filter(Boolean)];
  const filteredAgents = agentData.filter(agent => {
    const matchSearch = agent.meta.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                        agent.meta.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchCat = selectedCategory === 'All' || agent.meta.category === selectedCategory;
    return matchSearch && matchCat;
  });

  return (
    <div className="flex flex-col h-full bg-white relative dark:bg-[#121212] w-full">
      <div className="w-full border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between px-4 sm:px-6 pt-6 pb-4 max-w-screen-xl mx-auto w-full">
          <div className="flex items-center">
          <button 
            onClick={onClose}
            className="md:hidden p-2 -ml-2 text-gray-500 hover:text-black transition-colors rounded-full hover:bg-gray-50 mr-2 dark:hover:text-white dark:hover:bg-gray-800"
          >
            <ChevronLeft size={24} />
          </button>
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 p-2 rounded-xl mr-3">
            <Bot size={28} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight dark:text-white">Agent Store</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Discover and manage AI assistants</p>
          </div>
        </div>
        <button 
          onClick={onCreateCustomAgent}
          className="flex items-center gap-2 px-4 py-2 bg-black text-white hover:bg-gray-800 transition-colors rounded-xl dark:bg-white dark:text-black dark:hover:bg-gray-200"
        >
          <Plus size={18} />
          <span className="hidden sm:inline font-medium">Create Agent</span>
        </button>
        </div>
      </div>

      <div className="w-full bg-gray-50/50 dark:bg-[#181818] border-b border-gray-100 dark:border-gray-800">
        <div className="flex flex-col px-4 sm:px-6 py-4 gap-4 max-w-screen-xl mx-auto w-full">
        <div className="relative max-w-xl">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
            <Search size={18} className="text-gray-400" />
          </div>
          <input 
            type="text" 
            placeholder="Search thousands of agents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all text-sm text-gray-900 placeholder:text-gray-400 shadow-sm dark:bg-[#222] dark:border-gray-700 dark:text-white dark:focus:ring-blue-900"
          />
        </div>

        <div className="flex overflow-x-auto gap-2 pb-2 scrollbar-hide">
          {categories.map((cat: string) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-5 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors border ${
                selectedCategory === cat 
                  ? 'bg-black text-white border-black dark:bg-white dark:text-black' 
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 shadow-sm dark:bg-transparent dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto w-full px-4 sm:px-6 py-6 pb-24">
        <div className="w-full max-w-screen-xl mx-auto">
        {selectedCategory === 'All' && agents.length > 0 && (
           <div className="mb-8">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-widest mb-4 flex items-center dark:text-white">
                <span className="bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full">My Added / Custom</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {agents.map(agent => (
                   <div key={agent.id} className="flex flex-col bg-white dark:bg-[#1a1a1a] p-5 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm hover:border-gray-300 transition-colors group">
                      <div className="flex items-start">
                         <div className="flex-shrink-0 mr-4">
                            {agent.avatar.startsWith('http') || agent.avatar.startsWith('/') ? (
                               <img src={agent.avatar} alt={agent.name} className="w-14 h-14 rounded-2xl object-cover shadow-sm border border-gray-50 dark:border-gray-700" />
                            ) : (
                               <div className="w-14 h-14 rounded-2xl bg-gray-50 dark:bg-black flex items-center justify-center text-2xl shadow-inner border border-gray-100 dark:border-gray-800">
                                 {agent.avatar}
                               </div>
                            )}
                         </div>
                         <div className="flex-1 min-w-0">
                            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1 truncate">{agent.name}</h3>
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">Added</span>
                         </div>
                         <button onClick={() => onDeleteAgent(agent.id)} className="w-8 h-8 flex flex-shrink-0 items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-full transition-colors opacity-0 group-hover:opacity-100" title="Delete Custom Agent">
                            <Trash2 size={18} />
                         </button>
                      </div>
                   </div>
                ))}
              </div>
           </div>
        )}

        {filteredAgents.length > 0 ? (
          <div>
             <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-widest mb-4 flex items-center dark:text-white">
                <span className="bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full">{selectedCategory === 'All' ? 'Store Library' : selectedCategory}</span>
             </h2>
             <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
               {filteredAgents.map((agent) => {
                 const isEmoji = !agent.meta.avatar.startsWith('http');
                 const isAdded = agents.some(a => a.id === `agent-${agent.identifier}`);
                 return (
                   <div 
                     key={agent.identifier} 
                     onClick={() => onSelectStoreAgent(agent)}
                     className={`flex flex-col p-5 rounded-2xl border transition-all cursor-pointer h-full ${
                       isAdded 
                         ? 'bg-gray-50/50 border-gray-100 dark:bg-[#141414] dark:border-gray-800 opacity-70' 
                         : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-md dark:bg-[#1a1a1a] dark:border-gray-800 dark:hover:border-gray-600'
                     }`}
                   >
                     <div className="flex items-start mb-3">
                       <div className="flex-shrink-0 mr-4">
                         {isEmoji ? (
                           <div className="w-14 h-14 rounded-2xl bg-gray-50 dark:bg-[#222] flex items-center justify-center text-3xl shadow-inner border border-gray-100 dark:border-gray-800">
                             {agent.meta.avatar}
                           </div>
                         ) : (
                           <img src={agent.meta.avatar} alt="" className="w-14 h-14 rounded-2xl object-cover shadow-sm border border-gray-50 dark:border-gray-800" />
                         )}
                       </div>
                       <div className="flex-1 min-w-0 pt-1">
                         <h3 className="text-base font-semibold text-gray-900 dark:text-white line-clamp-1">{agent.meta.title}</h3>
                         <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{agent.meta.category || 'General'}</p>
                       </div>
                     </div>
                     <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2 mt-auto">{agent.meta.description}</p>
                     {isAdded && (
                        <div className="mt-4 flex">
                          <span className="inline-block px-2.5 py-1 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 text-xs rounded-md font-medium">Already Added</span>
                        </div>
                     )}
                   </div>
                 );
               })}
             </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 bg-gray-50 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
              <Bot size={32} className="text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No agents found</h3>
            <p className="text-gray-500 dark:text-gray-400">Try adjusting your search or category filter</p>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
