import React, { useState, useEffect, useCallback } from 'react';
import { MessageCircle } from 'lucide-react';
import { LoginScreen } from './components/LoginScreen';
import { ChatListScreen } from './components/ChatListScreen';
import { ActiveChatScreen } from './components/ActiveChatScreen';
import { ContactsScreen } from './components/ContactsScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { BottomNav, TabType } from './components/BottomNav';
import { UserDetailScreen } from './components/UserDetailScreen';
import { AgentDetailScreen } from './components/AgentDetailScreen';
import { CreateCustomAgentScreen } from './components/CreateCustomAgentScreen';
import { AgentStoreScreen } from './components/AgentStoreScreen';
import { NotificationToast, useToastNotifications } from './components/NotificationToast';
import { useAppState } from './hooks/useAppState';
import { streamChat } from './lib/api';
import { Chat, Message, User } from './types';
import agentData from './lib/agent.json';

export default function App() {
  const {
    currentUser,
    setCurrentUser,
    chats,
    users,
    agents,
    loading,
    typingUsers,
    friendRequests,
    notificationsEnabled,
    login,
    register,
    logout,
    checkAuth,
    loadMessages,
    sendMessage,
    createChat,
    createAgent,
    setChats,
    loadData,
    loadFriendRequests,
    acceptFriendRequest,
    rejectFriendRequest,
    sendFriendRequest,
    startTyping,
    stopTyping,
    setActiveChatId,
    toggleNotifications,
  } = useAppState();

  const [screen, setScreen] = useState<'login' | 'app'>('login');
  const [activeTab, setActiveTab] = useState<TabType>('chats');
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [activeMessages, setActiveMessages] = useState<Message[]>([]);
  const [selectedContact, setSelectedContact] = useState<User | null>(null);
  const [selectedStoreAgent, setSelectedStoreAgent] = useState<any | null>(null);
  const [isCreatingCustomAgent, setIsCreatingCustomAgent] = useState(false);
  const [isViewingAgentStore, setIsViewingAgentStore] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [isMobileView, setIsMobileView] = useState(window.innerWidth < 768);
  const { toasts, addToast, removeToast } = useToastNotifications();

  // Check auth on mount
  useEffect(() => {
    checkAuth().then(user => {
      if (user) setScreen('app');
    });
  }, []);

  // Load friend requests when app screen loads
  useEffect(() => {
    if (screen === 'app') {
      loadFriendRequests();
    }
  }, [screen, loadFriendRequests]);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  useEffect(() => {
    const handleResize = () => setIsMobileView(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Refresh data when page becomes visible (e.g., user switches back from another tab)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && currentUser) {
        loadData(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [currentUser, loadData]);

  // Listen for toast notifications from socket
  useEffect(() => {
    const handleToast = (e: Event) => {
      const { title, message, chatId } = (e as CustomEvent).detail;
      addToast(title, message, chatId);
    };
    window.addEventListener('toast:notification', handleToast);
    return () => window.removeEventListener('toast:notification', handleToast);
  }, [addToast]);

  // Listen for real-time messages from socket
  useEffect(() => {
    const handleNewMessage = (e: Event) => {
      const msg = (e as CustomEvent).detail as Message;
      const isMyMessage = msg.senderId === currentUser?.id;

      setActiveMessages(prev => {
        // Check if message already exists (by id or by temp id)
        if (prev.some(m => m.id === msg.id)) return prev;

        if (isMyMessage) {
          // Replace optimistic message (temp_*) with real message from server
          const tempIdx = prev.findIndex(m => m.id.startsWith('temp_') && m.senderId === currentUser?.id);
          if (tempIdx !== -1) {
            const updated = [...prev];
            updated[tempIdx] = msg;
            return updated;
          }
        }

        // For other users' messages, just append
        return [...prev, msg];
      });
    };

    window.addEventListener('socket:new_message', handleNewMessage);
    return () => window.removeEventListener('socket:new_message', handleNewMessage);
  }, [currentUser?.id]);

  const handleLogin = async (user: { id: string; name: string; email: string }) => {
    setCurrentUser(user);
    setScreen('app');
  };

  const handleLogout = () => {
    logout();
    setScreen('login');
    setActiveChat(null);
  };

  const handleSelectChat = async (chat: Chat) => {
    setActiveChat(chat);
    setActiveChatId(chat.id);
    setSelectedContact(null);
    try {
      const messages = await loadMessages(chat.id);
      setActiveMessages(messages);
    } catch (err) {
      console.error('Failed to load messages:', err);
      setActiveMessages([]);
    }
  };

  const updateChatList = (chatId: string, newMsg: Message) => {
    setChats(prevChats => {
      const chatIndex = prevChats.findIndex(c => c.id === chatId);
      if (chatIndex === -1) return prevChats;

      const updatedChats = [...prevChats];
      updatedChats[chatIndex] = {
        ...updatedChats[chatIndex],
        lastMessage: newMsg,
      };

      const [movedChat] = updatedChats.splice(chatIndex, 1);
      return [movedChat, ...updatedChats];
    });
  };

  const handleSendMessage = async (text: string) => {
    if (!activeChat || !currentUser) return;

    try {
      // Send via socket (optimistic)
      const savedMsg = await sendMessage(activeChat.id, text);
      setActiveMessages(prev => [...prev, savedMsg]);
      updateChatList(activeChat.id, savedMsg);

      // If this is an agent chat, get AI response
      if (activeChat.user.id.startsWith('agent-')) {
        let contextString = "You are a helpful AI assistant.";
        const storeAgent = agentData.find(a => `agent-${a.identifier}` === activeChat.user.id);
        if (storeAgent && (storeAgent.description || storeAgent.meta?.description)) {
          contextString = storeAgent.description || storeAgent.meta.description;
        } else if (activeChat.user.description) {
          contextString = activeChat.user.description;
        }

        // Check for custom API config from agent
        const agentConfig = {
          apiBaseUrl: (activeChat.user as any).apiBaseUrl,
          apiKey: (activeChat.user as any).apiKey,
          modelName: (activeChat.user as any).modelName,
        };
        const hasCustomConfig = agentConfig.apiBaseUrl && agentConfig.apiKey && agentConfig.modelName;

        const aiMsgId = `msg_${Date.now() + 1}`;
        const aiMsg: Message = {
          id: aiMsgId,
          senderId: activeChat.user.id,
          content: '',
          type: 'text',
          timestamp: new Date().toISOString(),
          isTyping: true,
        };

        setActiveMessages(prev => [...prev, aiMsg]);
        updateChatList(activeChat.id, aiMsg);

        try {
          const body = await streamChat(text, activeMessages, contextString, hasCustomConfig ? agentConfig : undefined);
          if (!body) throw new Error('No readable stream');
          const reader = body.getReader();
          const decoder = new TextDecoder('utf-8');
          let fullText = '';
          let isFirstChunk = true;

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (isFirstChunk) {
                const finalAiMsg = { ...aiMsg, isTyping: false };
                setActiveMessages(prev => prev.map(m => m.id === aiMsgId ? finalAiMsg : m));
                updateChatList(activeChat.id, finalAiMsg);
              }
              break;
            }

            isFirstChunk = false;
            const chunk = decoder.decode(value, { stream: true });
            fullText += chunk;

            const updatedAiMsg = { ...aiMsg, content: fullText, isTyping: false };
            setActiveMessages(prev => prev.map(m => m.id === aiMsgId ? updatedAiMsg : m));
            updateChatList(activeChat.id, updatedAiMsg);
          }

          // Save AI response to database
          if (fullText) {
            await sendMessage(activeChat.id, fullText);
          }
        } catch (err) {
          console.error('Failed to get AI response:', err);
        }
      }
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  const handleSelectContactAction = (user: User) => {
    setSelectedContact(user);
    setActiveChat(null);
  };

  const handleStartAgentChat = async (user: User, config?: any) => {
    try {
      let existingChat = chats.find(c => c.user.id === user.id);
      if (existingChat) {
        handleSelectChat(existingChat);
      } else {
        // Create agent in database with config
        if (config) {
          const agent = await createAgent({
            name: config.name,
            avatar: config.avatar,
            description: config.description,
            systemPrompt: config.systemPrompt,
            apiBaseUrl: config.apiBaseUrl,
            apiKey: config.apiKey,
            modelName: config.modelName,
          });
          // Update the user id to the actual agent id
          user = { ...user, id: agent.id };
        }
        const newChat = await createChat(undefined, user.id.startsWith('agent-') ? user.id : undefined, user.name);
        setActiveMessages([]);
        setActiveChat(newChat);
        setActiveChatId(newChat.id);
      }

      setIsViewingAgentStore(false);
      setSelectedStoreAgent(null);
      setIsCreatingCustomAgent(false);
      setSelectedContact(null);
      setActiveTab('chats');
    } catch (err) {
      console.error('Failed to start agent chat:', err);
    }
  };

  const handleMessageContact = async (user: User) => {
    let existingChat = chats.find(c => c.user.id === user.id);
    if (!existingChat) {
      try {
        existingChat = await createChat(user.id);
      } catch (err) {
        console.error('Failed to create chat:', err);
        return;
      }
    }
    setSelectedContact(null);
    setActiveTab('chats');
    handleSelectChat(existingChat);
  };

  const handleBackToChats = () => {
    setActiveChat(null);
    setActiveChatId(null);
  };

  const handleBackFromDetails = () => {
    setSelectedContact(null);
  };

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setActiveChat(null);
    setSelectedContact(null);
    setIsViewingAgentStore(false);
    // Refresh data when switching tabs
    loadData(false);
  };

  const handleAddAgent = (agent: any) => {
    createAgent({
      name: agent.name || agent.meta?.title,
      avatar: agent.avatar || agent.meta?.avatar,
      description: agent.description || agent.meta?.description,
      systemPrompt: agent.systemPrompt || agent.description,
    });
  };

  // Check if other user is typing in active chat
  const isOtherTyping = activeChat ? (typingUsers[activeChat.id] || []).some(id => id !== currentUser?.id) : false;

  // Loading state
  if (loading && screen === 'app') {
    return (
      <div className="h-screen w-full bg-[#f0f2f5] flex items-center justify-center dark:bg-[#121212]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-gray-300 border-t-[#1e2329] rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  // Login Screen
  if (screen === 'login') {
    return (
      <div className="h-screen w-full bg-[#f0f2f5] flex items-center justify-center dark:bg-[#121212]">
        <div className="w-full h-full overflow-hidden relative bg-white flex dark:bg-[#121212]">
          <LoginScreen onLogin={handleLogin} />
        </div>
      </div>
    );
  }

  // Main App
  return (
    <div className="h-screen w-full bg-[#f0f2f5] flex items-center justify-center">
      <div className="w-full h-full overflow-hidden flex bg-white relative dark:bg-[#121212]">

        {/* Left Side */}
        <div
          className={`
            w-full md:w-[380px] flex-shrink-0 border-r border-gray-100 bg-white relative
            ${isMobileView && (activeChat || selectedContact || isViewingAgentStore) ? 'hidden' : 'block'}
          `}
        >
          {activeTab === 'chats' && (
            <ChatListScreen
              chats={chats}
              onSelectChat={handleSelectChat}
              activeChatId={activeChat?.id}
              onDeleteChat={(chatId) => {
                setChats(prev => prev.filter(c => c.id !== chatId));
                if (activeChat?.id === chatId) {
                  setActiveChat(null);
                }
              }}
            />
          )}
          {activeTab === 'contacts' && (
            <ContactsScreen
              users={users}
              friendRequests={friendRequests}
              onSelectUser={handleSelectContactAction}
              onDeleteUser={(userId) => {
                setChats(prev => prev.filter(c => c.user.id !== userId));
                if (selectedContact?.id === userId) {
                  setSelectedContact(null);
                }
                if (activeChat?.user.id === userId) {
                  setActiveChat(null);
                }
              }}
              onAcceptRequest={acceptFriendRequest}
              onRejectRequest={rejectFriendRequest}
              onSendRequest={sendFriendRequest}
            />
          )}
          {activeTab === 'settings' && (
            <SettingsScreen
              onLogout={handleLogout}
              isDark={isDark}
              onToggleDark={setIsDark}
              onOpenAgentStore={() => {
                setIsViewingAgentStore(true);
                setActiveChat(null);
                setSelectedContact(null);
                setSelectedStoreAgent(null);
                setIsCreatingCustomAgent(false);
              }}
              notificationsEnabled={notificationsEnabled}
              onToggleNotifications={toggleNotifications}
              currentUser={currentUser || undefined}
              onProfileUpdate={(user) => {
                setCurrentUser(user);
              }}
            />
          )}

          <BottomNav activeTab={activeTab} onChangeTab={handleTabChange} friendRequestCount={friendRequests.length} />
        </div>

        {/* Right Side */}
        <div
          className={`
            flex-1 min-w-0 w-full bg-white relative
            ${isMobileView && (!activeChat && !selectedContact && !isViewingAgentStore) ? 'hidden' : 'block'}
            ${!isMobileView && (!activeChat && !selectedContact && !isViewingAgentStore) ? 'hidden md:flex items-center justify-center bg-gray-50' : ''}
          `}
        >
          {isViewingAgentStore ? (
            <AgentStoreScreen
              onClose={() => setIsViewingAgentStore(false)}
              agents={users.filter(u => u.id.startsWith('agent-'))}
              onSelectStoreAgent={(agentConfig) => setSelectedStoreAgent(agentConfig)}
              onCreateCustomAgent={() => setIsCreatingCustomAgent(true)}
              onDeleteAgent={(id) => {
                setChats(prev => prev.filter(chat => chat.user.id !== id));
                if (activeChat?.user.id === id) {
                  setActiveChat(null);
                }
              }}
            />
          ) : activeChat ? (
            <ActiveChatScreen
              chat={activeChat}
              messages={activeMessages}
              onBack={handleBackToChats}
              isMobile={isMobileView}
              onSendMessage={handleSendMessage}
              onClearChat={() => setActiveMessages([])}
              currentUserId={currentUser?.id}
              onTyping={() => startTyping(activeChat.id)}
              onStopTyping={() => stopTyping(activeChat.id)}
              isOtherTyping={isOtherTyping}
            />
          ) : selectedContact ? (
            <UserDetailScreen
              user={selectedContact}
              onBack={handleBackFromDetails}
              onMessage={handleMessageContact}
              isMobile={isMobileView}
            />
          ) : (
            <div className="text-gray-400 font-medium bg-white px-6 py-3 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center gap-3">
              <MessageCircle size={48} className="text-gray-300" strokeWidth={1.5} />
              <p>Select a chat or contact to start messaging</p>
            </div>
          )}
        </div>

        {/* Overlays */}
        {selectedStoreAgent && (
          <AgentDetailScreen
            agentData={selectedStoreAgent}
            onClose={() => setSelectedStoreAgent(null)}
            onStartChat={handleStartAgentChat}
          />
        )}
        {isCreatingCustomAgent && (
          <CreateCustomAgentScreen
            onClose={() => setIsCreatingCustomAgent(false)}
            onSave={handleStartAgentChat}
          />
        )}

        {/* Toast Notifications */}
        <NotificationToast
          toasts={toasts}
          onClose={removeToast}
          onToastClick={(chatId) => {
            const chat = chats.find(c => c.id === chatId);
            if (chat) {
              handleSelectChat(chat);
            }
          }}
        />
      </div>
    </div>
  );
}
