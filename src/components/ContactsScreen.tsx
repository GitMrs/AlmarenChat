import React, { useState } from 'react';
import { Search, Plus, Trash2 } from 'lucide-react';
import { User } from '../types';

interface ContactsScreenProps {
  users: User[];
  onSelectUser: (user: User) => void;
  onDeleteUser?: (userId: string) => void;
}

export function ContactsScreen({ users, onSelectUser, onDeleteUser }: ContactsScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredUsers = users.filter(user => 
    user.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-white relative">
      {/* App Bar */}
      <div className="flex flex-col px-6 pt-6 pb-2 gap-4">
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight dark:text-gray-100">Contacts</h1>
        
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
            <Search size={18} className="text-gray-400" />
          </div>
          <input 
            type="text" 
            placeholder="Search contacts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-transparent rounded-xl outline-none focus:bg-white focus:border-gray-200 focus:ring-4 focus:ring-gray-50 transition-all text-sm text-gray-900 placeholder:text-gray-400 dark:bg-[#1e2329] dark:focus:bg-[#1e2329] dark:focus:border-gray-700 dark:text-white dark:focus:ring-gray-800"
          />
        </div>
      </div>

      {/* Contact List */}
      <div className="flex-1 overflow-y-auto px-4 pb-24 pt-2">
        {filteredUsers.length === 0 ? (
          <div className="text-center text-gray-500 py-10 text-sm">No contacts found.</div>
        ) : (
          filteredUsers.map((user) => (
          <div 
            key={user.id} 
            onClick={() => onSelectUser(user)}
            className="flex items-center p-3 rounded-2xl cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors mb-1 select-none group relative"
          >
            {/* Avatar */}
            <div className="relative flex-shrink-0 mr-4">
              {user.avatar.startsWith('http') || user.avatar.startsWith('/') ? (
                <img 
                  src={user.avatar} 
                  alt={user.name} 
                  className="w-12 h-12 rounded-xl object-cover"
                />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xl">
                  {user.avatar}
                </div>
              )}
              {user.isOnline && (
                <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-white dark:border-[#1a1a1a]"></div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pr-8 transition-all">
              <h3 className="font-medium text-[16px] text-gray-900 dark:text-white truncate">
                {user.name}
              </h3>
              <p className="text-[13px] text-gray-400 mt-0.5">
                {user.isOnline ? 'Online' : 'Offline'}
              </p>
            </div>
            
            {onDeleteUser && user.id.startsWith('agent-') && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteUser(user.id);
                }}
                className="hidden group-hover:flex absolute right-4 items-center justify-center p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                title="Delete Contact"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        )))}
      </div>
    </div>
  );
}
