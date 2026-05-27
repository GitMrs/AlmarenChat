import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../lib/api';
import { connectSocket, disconnectSocket, getSocket } from '../lib/socket';
import * as cache from '../lib/cache';
import { Chat, Message, User, FriendRequest } from '../types';

// Web Audio API notification sound
let audioCtx: AudioContext | null = null;

function playNotificationSound() {
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    const ctx = audioCtx;
    const playNote = (freq: number, startTime: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };
    const now = ctx.currentTime;
    playNote(880, now, 0.15);
    playNote(1320, now + 0.15, 0.2);
  } catch (e) {
    // Audio not supported or blocked
  }
}

// Browser notification
function showBrowserNotification(title: string, body: string, avatar?: string, onClick?: () => void) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const notification = new Notification(title, {
    body,
    icon: avatar || undefined,
    tag: 'almaren-chat',
  });

  if (onClick) {
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
  }
}

export function useAppState() {
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; email: string } | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);  // 初始加载
  const [refreshing, setRefreshing] = useState(false);  // 刷新状态（不显示全屏loading）
  const [typingUsers, setTypingUsers] = useState<Record<string, string[]>>({});
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem('notifications_enabled');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });

  const activeChatIdRef = useRef<string | null>(null);
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  // Save notification preference
  useEffect(() => {
    localStorage.setItem('notifications_enabled', JSON.stringify(notificationsEnabled));
  }, [notificationsEnabled]);

  // Request notification permission on login
  useEffect(() => {
    if (currentUser && notificationsEnabled && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  }, [currentUser, notificationsEnabled]);

  // Update tab title with unread count
  useEffect(() => {
    const totalUnread = chats.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    document.title = totalUnread > 0 ? `(${totalUnread}) AlmarenChat` : 'AlmarenChat';
  }, [chats]);

  // Load initial data
  const loadData = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      const [chatsData, usersData, agentsData] = await Promise.all([
        api.getChats(),
        api.getUsers(),
        api.getAgents(),
      ]);

      const transformedChats: Chat[] = chatsData.map((chat: any) => {
        const otherParticipant = chat.users.find((u: any) => u.userId !== currentUserRef.current?.id);
        const user = otherParticipant?.user || otherParticipant?.agent || { id: 'unknown', name: 'Unknown', avatar: '👤', isOnline: false };
        const lastMsg = chat.messages?.[0];

        return {
          id: chat.id,
          user: {
            id: user.id,
            name: user.name,
            avatar: user.avatar || '👤',
            isOnline: user.isOnline || false,
          },
          lastMessage: lastMsg ? {
            id: lastMsg.id,
            senderId: lastMsg.senderId,
            content: lastMsg.content,
            type: lastMsg.type,
            timestamp: lastMsg.createdAt,
            status: lastMsg.status,
          } : {
            id: 'empty',
            senderId: '',
            content: 'No messages yet',
            type: 'text',
            timestamp: chat.createdAt,
          },
          unreadCount: 0,
        };
      });

      setChats(transformedChats);
      setUsers(usersData.map((u: any) => ({
        id: u.id,
        name: u.name,
        avatar: u.avatar || '👤',
        isOnline: u.isOnline || false,
      })));
      setAgents(agentsData);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Setup socket listeners
  useEffect(() => {
    if (!currentUser) return;

    const socket = connectSocket();

    // New message from socket
    socket.on('new_message', (msg: any) => {
      const message: Message = {
        id: msg.id,
        senderId: msg.senderId,
        content: msg.content,
        type: msg.type,
        timestamp: msg.timestamp,
        status: msg.status,
      };

      const isActiveChat = activeChatIdRef.current === msg.chatId;
      const isMyMessage = msg.senderId === currentUserRef.current?.id;

      // Update active messages if in the same chat
      if (isActiveChat) {
        window.dispatchEvent(new CustomEvent('socket:new_message', { detail: message }));
      }

      // Update chat list
      setChats(prev => {
        const idx = prev.findIndex(c => c.id === msg.chatId);
        if (idx === -1) return prev;
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          lastMessage: message,
          // Increment unread if not active chat and not my message
          unreadCount: (!isActiveChat && !isMyMessage)
            ? (updated[idx].unreadCount || 0) + 1
            : updated[idx].unreadCount,
        };
        const [moved] = updated.splice(idx, 1);
        return [moved, ...updated];
      });

      // Notifications for messages from others
      if (!isMyMessage) {
        // Find sender name
        const senderName = msg.senderName || 'Someone';

        // Toast notification (frontend notification)
        if (notificationsEnabled) {
          showToastNotification(senderName, msg.content, msg.chatId);
        }

        // Browser notification (if tab not visible)
        if (notificationsEnabled && document.hidden) {
          showBrowserNotification(
            senderName,
            msg.content,
            undefined,
            () => {
              // Navigate to chat on click
              window.dispatchEvent(new CustomEvent('notification:open_chat', { detail: { chatId: msg.chatId } }));
            }
          );
        }

        // Sound notification
        if (notificationsEnabled) {
          playNotificationSound();
        }
      }

      // Cache message
      cache.appendMessage(msg.chatId, message);
    });

    // Typing indicator
    socket.on('typing_update', ({ chatId, userId, isTyping }: { chatId: string; userId: string; isTyping: boolean }) => {
      setTypingUsers(prev => {
        const current = prev[chatId] || [];
        if (isTyping) {
          if (current.includes(userId)) return prev;
          return { ...prev, [chatId]: [...current, userId] };
        } else {
          return { ...prev, [chatId]: current.filter(id => id !== userId) };
        }
      });
    });

    // User status change
    socket.on('user_status', ({ userId, isOnline }: { userId: string; isOnline: boolean }) => {
      setUsers(prev => prev.map(u =>
        u.id === userId ? { ...u, isOnline } : u
      ));
      setChats(prev => prev.map(c =>
        c.user.id === userId ? { ...c, user: { ...c.user, isOnline } } : c
      ));
    });

    // Message status update
    socket.on('message_status', ({ messageId, status }: { messageId: string; status: string }) => {
      window.dispatchEvent(new CustomEvent('socket:message_status', { detail: { messageId, status } }));
    });

    return () => {
      disconnectSocket();
    };
  }, [currentUser, notificationsEnabled]);

  useEffect(() => {
    if (currentUser) {
      loadData(true);
    }
  }, [currentUser, loadData]);

  // Auth
  const login = async (email: string, password: string) => {
    const data = await api.login(email, password);
    setCurrentUser(data.user);
    return data.user;
  };

  const register = async (email: string, password: string, name: string) => {
    const data = await api.register(email, password, name);
    setCurrentUser(data.user);
    return data.user;
  };

  const logout = () => {
    disconnectSocket();
    api.logout();
    setCurrentUser(null);
    setChats([]);
    setUsers([]);
    setAgents([]);
    document.title = 'AlmarenChat';
  };

  const checkAuth = async () => {
    try {
      const user = await api.getMe();
      setCurrentUser(user);
      return user;
    } catch {
      return null;
    }
  };

  // Messages - load from cache first, then API
  const loadMessages = async (chatId: string): Promise<Message[]> => {
    activeChatIdRef.current = chatId;

    // Clear unread count for this chat
    setChats(prev => prev.map(c =>
      c.id === chatId ? { ...c, unreadCount: 0 } : c
    ));

    // Load from cache instantly
    const cached = cache.loadMessages(chatId);

    // Then fetch from API
    try {
      const messages = await api.getMessages(chatId);
      const transformed: Message[] = messages.map((m: any) => ({
        id: m.id,
        senderId: m.senderId,
        content: m.content,
        type: m.type,
        timestamp: m.createdAt,
        status: m.status,
      }));

      // Update cache
      cache.saveMessages(chatId, transformed);

      // Join socket room
      const socket = getSocket();
      if (socket) {
        socket.emit('join_chat', { chatId });
      }

      return transformed;
    } catch (err) {
      return cached;
    }
  };

  // Send message via socket (optimistic)
  const sendMessage = async (chatId: string, content: string, type: 'text' | 'image' | 'audio' = 'text'): Promise<Message> => {
    const socket = getSocket();
    if (!socket) throw new Error('Socket not connected');

    const optimisticMsg: Message = {
      id: `temp_${Date.now()}`,
      senderId: currentUser!.id,
      content,
      type,
      timestamp: new Date().toISOString(),
      status: 'sent',
    };

    socket.emit('send_message', { chatId, content, type });

    return optimisticMsg;
  };

  // Typing
  const startTyping = (chatId: string) => {
    const socket = getSocket();
    if (socket) socket.emit('typing_start', { chatId });
  };

  const stopTyping = (chatId: string) => {
    const socket = getSocket();
    if (socket) socket.emit('typing_stop', { chatId });
  };

  // Create chat
  const createChat = async (targetUserId?: string, agentId?: string, title?: string): Promise<Chat> => {
    const chat = await api.createChat({ targetUserId, agentId, title });
    const otherParticipant = chat.users.find((u: any) => u.userId !== currentUser?.id);
    const user = otherParticipant?.user || otherParticipant?.agent || { id: 'unknown', name: 'Unknown', avatar: '👤', isOnline: false };

    const newChat: Chat = {
      id: chat.id,
      user: {
        id: user.id,
        name: user.name,
        avatar: user.avatar || '👤',
        isOnline: user.isOnline || false,
      },
      lastMessage: {
        id: 'empty',
        senderId: '',
        content: 'No messages yet',
        type: 'text',
        timestamp: chat.createdAt,
      },
      unreadCount: 0,
    };

    setChats(prev => [newChat, ...prev]);

    const socket = getSocket();
    if (socket) socket.emit('join_chat', { chatId: chat.id });

    return newChat;
  };

  // Agents
  const createAgent = async (data: { name: string; avatar?: string; description?: string; systemPrompt?: string; apiBaseUrl?: string; apiKey?: string; modelName?: string }) => {
    const agent = await api.createAgent(data);
    setAgents(prev => [agent, ...prev]);
    return agent;
  };

  const setActiveChatId = (chatId: string | null) => {
    activeChatIdRef.current = chatId;
    if (chatId) {
      // Clear unread when entering chat
      setChats(prev => prev.map(c =>
        c.id === chatId ? { ...c, unreadCount: 0 } : c
      ));
      const socket = getSocket();
      if (socket) socket.emit('join_chat', { chatId });
    }
  };

  const toggleNotifications = (enabled: boolean) => {
    setNotificationsEnabled(enabled);
    if (enabled && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  };

  // Toast notifications for new messages
  const showToastNotification = useCallback((title: string, message: string, chatId?: string) => {
    // Dispatch custom event for App component to handle
    window.dispatchEvent(new CustomEvent('toast:notification', {
      detail: { title, message, chatId }
    }));
  }, []);

  // Friend requests
  const loadFriendRequests = useCallback(async () => {
    try {
      const requests = await api.getFriendRequests();
      setFriendRequests(requests.map((r: any) => ({
        id: r.id,
        userId: r.userId,
        friendId: r.friendId,
        status: r.status,
        user: {
          id: r.user.id,
          name: r.user.name,
          avatar: r.user.avatar || '👤',
          isOnline: r.user.isOnline || false,
        },
      })));
    } catch (err) {
      console.error('Failed to load friend requests:', err);
    }
  }, []);

  const acceptFriendRequest = async (friendshipId: string) => {
    try {
      await api.acceptFriendRequest(friendshipId);
      // 从请求列表中找到该用户，加入好友列表
      const request = friendRequests.find(r => r.id === friendshipId);
      if (request) {
        setUsers(prev => [...prev, request.user]);
        setFriendRequests(prev => prev.filter(r => r.id !== friendshipId));
      } else {
        setFriendRequests(prev => prev.filter(r => r.id !== friendshipId));
      }
    } catch (err) {
      console.error('Failed to accept friend request:', err);
    }
  };

  const rejectFriendRequest = async (friendshipId: string) => {
    try {
      await api.rejectFriendRequest(friendshipId);
      setFriendRequests(prev => prev.filter(r => r.id !== friendshipId));
    } catch (err) {
      console.error('Failed to reject friend request:', err);
    }
  };

  const sendFriendRequest = async (userId: string) => {
    try {
      await api.sendFriendRequest(userId);
    } catch (err) {
      console.error('Failed to send friend request:', err);
      throw err;
    }
  };

  return {
    currentUser,
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
    setCurrentUser,
    toggleNotifications,
    showToastNotification,
  };
}
