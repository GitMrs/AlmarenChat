import React, { useState, useEffect } from 'react';
import { Search, Plus, X, UserCheck, UserX, Check, Trash2 } from 'lucide-react';
import { User, FriendRequest } from '../types';
import { cn } from '../lib/utils';
import * as api from '../lib/api';

interface ContactsScreenProps {
  users: User[];
  friendRequests: FriendRequest[];
  onSelectUser: (user: User) => void;
  onDeleteUser?: (userId: string) => void;
  onAcceptRequest: (friendshipId: string) => void;
  onRejectRequest: (friendshipId: string) => void;
  onSendRequest: (userId: string) => void;
}

export function ContactsScreen({
  users,
  friendRequests,
  onSelectUser,
  onDeleteUser,
  onAcceptRequest,
  onRejectRequest,
  onSendRequest,
}: ContactsScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [sentRequests, setSentRequests] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (showSearchModal && searchQuery.length >= 2) {
      const timer = setTimeout(async () => {
        setSearching(true);
        try {
          const results = await api.searchUsers(searchQuery);
          setSearchResults(results);
        } catch (err) {
          console.error('Search failed:', err);
          setSearchResults([]);
        } finally {
          setSearching(false);
        }
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, showSearchModal]);

  const handleSendRequest = async (userId: string) => {
    try {
      await onSendRequest(userId);
      setSentRequests(prev => new Set(prev).add(userId));
    } catch (err) {
      console.error('Failed to send request:', err);
    }
  };

  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-white relative">
      {/* App Bar */}
      <div className="flex flex-col px-6 pt-6 pb-2 gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Contacts</h1>
          <button
            onClick={() => setShowSearchModal(true)}
            className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 hover:bg-gray-200 transition-colors"
          >
            <Plus size={22} strokeWidth={2.5} />
          </button>
        </div>

        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
            <Search size={18} className="text-gray-400" />
          </div>
          <input
            type="text"
            placeholder="Search contacts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-transparent rounded-xl outline-none focus:bg-white focus:border-gray-200 focus:ring-4 focus:ring-gray-50 transition-all text-sm text-gray-900 placeholder:text-gray-400"
          />
        </div>
      </div>

      {/* Friend Requests Section */}
      {friendRequests.length > 0 && (
        <div className="px-4 pb-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Friend Requests</h3>
          <div className="space-y-2">
            {friendRequests.map((request) => (
              <div key={request.id} className="flex items-center p-3 bg-gray-50 rounded-2xl">
                <div className="w-10 h-10 rounded-xl bg-gray-200 overflow-hidden mr-3 flex items-center justify-center text-lg font-medium">
                  {(request.user.avatar || '').startsWith('http') ? (
                    <img src={request.user.avatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    request.user.avatar
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[15px] text-gray-900 truncate">{request.user.name}</p>
                  <p className="text-[12px] text-gray-400">Wants to be your friend</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => onAcceptRequest(request.id)}
                    className="w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center hover:bg-green-600 transition-colors"
                    title="Accept"
                  >
                    <Check size={16} strokeWidth={2.5} />
                  </button>
                  <button
                    onClick={() => onRejectRequest(request.id)}
                    className="w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition-colors"
                    title="Reject"
                  >
                    <X size={16} strokeWidth={2.5} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Contact List */}
      <div className="flex-1 overflow-y-auto px-4 pb-24 pt-2">
        {filteredUsers.length === 0 ? (
          <div className="text-center text-gray-500 py-10 text-sm">
            {users.length === 0 ? 'No friends yet. Click + to add friends!' : 'No contacts found.'}
          </div>
        ) : (
          filteredUsers.map((user) => (
            <div
              key={user.id}
              onClick={() => onSelectUser(user)}
              className="flex items-center p-3 rounded-2xl cursor-pointer hover:bg-gray-50 transition-colors mb-1 select-none group relative"
            >
              {/* Avatar */}
              <div className="relative flex-shrink-0 mr-4">
                {(user.avatar || '').startsWith('http') || (user.avatar || '').startsWith('/') ? (
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="w-12 h-12 rounded-xl object-cover"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center text-xl">
                    {user.avatar}
                  </div>
                )}
                {user.isOnline && (
                  <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-white"></div>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pr-8 transition-all">
                <h3 className="font-medium text-[16px] text-gray-900 truncate">
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
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add Friend Modal */}
      {showSearchModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowSearchModal(false)} />
          <div className="relative w-full max-w-md bg-white rounded-t-3xl p-6 pb-10 max-h-[80vh] overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Add Friend</h2>
              <button
                onClick={() => setShowSearchModal(false)}
                className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="relative mb-4">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Search size={18} className="text-gray-400" />
              </div>
              <input
                type="text"
                placeholder="Search by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl outline-none focus:bg-white focus:border-gray-200 focus:ring-4 focus:ring-gray-50 transition-all text-sm text-gray-900 placeholder:text-gray-400"
              />
            </div>

            <div className="flex-1 overflow-y-auto">
              {searching ? (
                <div className="text-center text-gray-400 py-8">Searching...</div>
              ) : searchResults.length === 0 && searchQuery.length >= 2 ? (
                <div className="text-center text-gray-400 py-8">No users found</div>
              ) : searchResults.length === 0 ? (
                <div className="text-center text-gray-400 py-8">Type at least 2 characters to search</div>
              ) : (
                <div className="space-y-2">
                  {searchResults.map((user) => {
                    const isFriend = users.some(u => u.id === user.id);
                    const isSent = sentRequests.has(user.id);

                    return (
                      <div
                        key={user.id}
                        className="flex items-center p-3 bg-gray-50 rounded-2xl"
                      >
                        <div className="w-10 h-10 rounded-xl bg-gray-200 overflow-hidden mr-3 flex items-center justify-center text-lg font-medium">
                          {(user.avatar || '').startsWith('http') ? (
                            <img src={user.avatar} alt="" className="w-full h-full object-cover" />
                          ) : (
                            user.avatar || '👤'
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-[15px] text-gray-900 truncate">{user.name}</p>
                          <p className="text-[12px] text-gray-400 truncate">{user.isOnline ? 'Online' : 'Offline'}</p>
                        </div>
                        {isFriend ? (
                          <div className="flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-600 rounded-full text-xs font-medium">
                            <UserCheck size={14} />
                            Friends
                          </div>
                        ) : isSent ? (
                          <div className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-500 rounded-full text-xs font-medium">
                            Request Sent
                          </div>
                        ) : (
                          <button
                            onClick={() => handleSendRequest(user.id)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-[#1e2329] text-white rounded-full text-xs font-medium hover:bg-black transition-colors"
                          >
                            <Plus size={14} />
                            Add
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}