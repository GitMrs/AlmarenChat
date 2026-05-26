import React, { useState, useEffect } from 'react';
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
import { mockChats, getBigChatMessages, MOCK_USERS, currentUserObj } from './mockData';
import agentData from './lib/agent.json';
import { Chat, Message, User } from './types';

export default function App() {
  const [screen, setScreen] = useState<'login' | 'app'>('login');
  const [activeTab, setActiveTab] = useState<TabType>('chats');
  const [chats, setChats] = useState<Chat[]>(() => {
    try {
      const saved = localStorage.getItem('agent_chats');
      return saved ? JSON.parse(saved) : mockChats;
    } catch { return mockChats; }
  });
  const [users, setUsers] = useState<User[]>(() => {
    try {
      const saved = localStorage.getItem('agent_users');
      return saved ? JSON.parse(saved) : MOCK_USERS;
    } catch { return MOCK_USERS; }
  });
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [activeMessages, setActiveMessages] = useState<Message[]>([]);
  
  useEffect(() => {
    localStorage.setItem('agent_chats', JSON.stringify(chats));
  }, [chats]);

  useEffect(() => {
    localStorage.setItem('agent_users', JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    if (activeChat && activeChat.user.id.startsWith('agent-')) {
      localStorage.setItem(`agent_messages_${activeChat.id}`, JSON.stringify(activeMessages));
    }
  }, [activeMessages, activeChat]);
  const [selectedContact, setSelectedContact] = useState<User | null>(null);
  const [selectedStoreAgent, setSelectedStoreAgent] = useState<any | null>(null);
  const [isCreatingCustomAgent, setIsCreatingCustomAgent] = useState(false);
  const [isViewingAgentStore, setIsViewingAgentStore] = useState(false);
  const [isDark, setIsDark] = useState(false);
  
  // Basic responsive check to adjust behavior for mobile (stack) vs desktop (split)
  const [isMobileView, setIsMobileView] = useState(window.innerWidth < 768);

  const handleAddAgent = (agent: User) => {
    if (users.find(u => u.id === agent.id)) return;
    setUsers([agent, ...users]);
  };

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

  const handleLogin = () => {
    setScreen('app');
  };

  const handleLogout = () => {
    setScreen('login');
    setActiveChat(null);
  };

  const handleSelectChat = (chat: Chat) => {
    setActiveChat(chat);
    setSelectedContact(null);
    if (chat.user.id.startsWith('agent-')) {
      const savedMsgs = localStorage.getItem(`agent_messages_${chat.id}`);
      setActiveMessages(savedMsgs ? JSON.parse(savedMsgs) : []);
    } else {
      // Load the 100k messages to prove performance
      setTimeout(() => {
         setActiveMessages(getBigChatMessages(chat.user.id));
      }, 0);
    }
  };

  const updateChatList = (chatId: string, newMsg: Message) => {
    setChats(prevChats => {
      const chatIndex = prevChats.findIndex(c => c.id === chatId);
      if (chatIndex === -1) return prevChats;
      
      const updatedChats = [...prevChats];
      updatedChats[chatIndex] = {
        ...updatedChats[chatIndex],
        lastMessage: newMsg
      };
      
      const [movedChat] = updatedChats.splice(chatIndex, 1);
      return [movedChat, ...updatedChats];
    });
  };

  const handleSendMessage = async (text: string) => {
    if (!activeChat) return;
    
    // Create new message object
    const newMsg: Message = {
      id: `msg_${Date.now()}`,
      senderId: currentUserObj.id,
      content: text,
      type: 'text',
      timestamp: new Date().toISOString()
    };
    
    // Append to virtualized list
    setActiveMessages(prev => [...prev, newMsg]);

    // Update chats list (move to top and update last message)
    updateChatList(activeChat.id, newMsg);

    if (activeChat.user.id.startsWith('agent-')) {
      let contextString = "You are a helpful AI assistant.";
      // For custom agents, they might not be in agentData but we could pass their custom prompt if stored, but let's handle store agents first
      const storeAgent = agentData.find(a => `agent-${a.identifier}` === activeChat.user.id);
      if (storeAgent && (storeAgent.description || storeAgent.meta?.description)) {
         contextString = storeAgent.description || storeAgent.meta.description;
      } else if (activeChat.user.description) {
         contextString = activeChat.user.description;
      }
      // activeMessages doesn't yet have newMsg in its closure so it's the right history to pass
      const historyToPass = [...activeMessages];
      
      const aiMsgId = `msg_${Date.now() + 1}`;
      const aiMsg: Message = {
        id: aiMsgId,
        senderId: activeChat.user.id,
        content: '',
        type: 'text',
        timestamp: new Date().toISOString(),
        isTyping: true
      };
      
      setActiveMessages(prev => [...prev, aiMsg]);
      updateChatList(activeChat.id, aiMsg);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            history: historyToPass,
            context: contextString
          })
        });
        if (!res.body) throw new Error('No readable stream');
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let fullText = '';
        
        let isFirstChunk = true;

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Unset typing indicator if stream ends immediately
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
          
          setActiveMessages(prev => 
            prev.map(m => m.id === aiMsgId ? updatedAiMsg : m)
          );
          updateChatList(activeChat.id, updatedAiMsg);
        }
      } catch (err) {
        console.error('Failed to get AI response:', err);
      }
    }
  };

  const handleSelectContactAction = (user: User) => {
    setSelectedContact(user);
    setActiveChat(null);
  };

  const handleStartAgentChat = (user: User) => {
    // 1. Ensure user is in contacts array
    if (!users.find(u => u.id === user.id)) {
      setUsers(prev => [user, ...prev]);
    }
    
    // 2. Find or create a chat
    let chat = chats.find(c => c.user.id === user.id);
    if (!chat) {
      const newLastMsg: Message = {
        id: `msg-${Date.now()}`,
        content: `Hi there! I am ${user.name}.`,
        timestamp: new Date().toISOString(),
        senderId: user.id,
        type: 'text'
      };
      
      chat = {
        id: `chat-${user.id}`,
        user: user,
        unreadCount: 0,
        lastMessage: newLastMsg
      };
      setChats(prev => [chat!, ...prev]);
      setActiveMessages([newLastMsg]);
    } else {
      if (chat.user.id.startsWith('agent-')) {
        const savedMsgs = localStorage.getItem(`agent_messages_${chat.id}`);
        setActiveMessages(savedMsgs ? JSON.parse(savedMsgs) : []);
      } else {
        setTimeout(() => {
          setActiveMessages(getBigChatMessages(chat!.user.id));
        }, 0);
      }
    }
    
    // 3. Clear store states and start chat
    setIsViewingAgentStore(false);
    setSelectedStoreAgent(null);
    setIsCreatingCustomAgent(false);
    setSelectedContact(null);
    setActiveTab('chats');
    setActiveChat(chat);
  };

  const handleMessageContact = (user: User) => {
    let existingChat = chats.find(c => c.user.id === user.id);
    if (!existingChat) {
       existingChat = chats[0];
    }
    setSelectedContact(null);
    setActiveTab('chats');
    handleSelectChat(existingChat);
  };

  const handleBackToChats = () => {
    setActiveChat(null);
  };

  const handleBackFromDetails = () => {
    setSelectedContact(null);
  };

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setActiveChat(null);
    setSelectedContact(null);
    setIsViewingAgentStore(false);
  };

  // 1. Login Screen View
  if (screen === 'login') {
    return (
      <div className="h-screen w-full bg-[#f0f2f5] flex items-center justify-center dark:bg-[#121212]">
        <div className="w-full h-full overflow-hidden relative bg-white flex dark:bg-[#121212]">
          <LoginScreen onLogin={handleLogin} />
        </div>
      </div>
    );
  }

  // 2. Main App View (Responsive)
  return (
    <div className="h-screen w-full bg-[#f0f2f5] flex items-center justify-center">
      <div className="w-full h-full overflow-hidden flex bg-white relative dark:bg-[#121212]">
        
        {/* Left Side: Navigation & Target List (Visible always on desktop, conditionally on mobile) */}
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
                localStorage.removeItem(`agent_messages_${chatId}`);
              }}
            />
          )}
          {activeTab === 'contacts' && (
               <ContactsScreen
                 users={users}
                 onSelectUser={handleSelectContactAction}
                 onDeleteUser={(userId) => {
                   setUsers(prev => prev.filter(u => u.id !== userId));
                   const chatToDelete = chats.find(c => c.user.id === userId);
                   if (chatToDelete) {
                     localStorage.removeItem(`agent_messages_${chatToDelete.id}`);
                   }
                   setChats(prev => prev.filter(c => c.user.id !== userId));
                   if (selectedContact?.id === userId) {
                     setSelectedContact(null);
                   }
                   if (activeChat?.user.id === userId) {
                     setActiveChat(null);
                   }
                 }}
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
             />
          )}

          <BottomNav activeTab={activeTab} onChangeTab={handleTabChange} />
        </div>

        {/* Right Side: Active Chat & Details (Visible conditionally based on selection) */}
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
                 setUsers(prev => prev.filter(u => u.id !== id));
                 const chatToDelete = chats.find(c => c.user.id === id);
                 if (chatToDelete) {
                   localStorage.removeItem(`agent_messages_${chatToDelete.id}`);
                 }
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
              onClearChat={() => {
                setActiveMessages([]);
                if (activeChat.user.id.startsWith('agent-')) {
                  localStorage.removeItem(`agent_messages_${activeChat.id}`);
                }
              }}
            />
          ) : selectedContact ? (
            <UserDetailScreen
              user={selectedContact}
              onBack={handleBackFromDetails}
              onMessage={handleMessageContact}
              isMobile={isMobileView}
            />
          ) : (
             // Desktop empty state
            <div className="text-gray-400 font-medium bg-white px-6 py-3 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center gap-3">
              <MessageCircle size={48} className="text-gray-300" strokeWidth={1.5} />
              <p>Select a chat or contact to start messaging</p>
            </div>
          )}
        </div>
        
        {/* Full-Screen overlays (Drawers) */}
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
      </div>
    </div>
  );
}

