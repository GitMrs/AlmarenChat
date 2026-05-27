export interface User {
  id: string;
  name: string;
  avatar: string;
  isOnline: boolean;
  description?: string;
  friendshipId?: string;
}

export type MessageType = 'text' | 'image' | 'audio';

export interface Message {
  id: string;
  senderId: string;
  content: string;
  type: MessageType;
  timestamp: string;
  imageUrls?: string[];
  isTyping?: boolean;
  status?: 'sent' | 'delivered' | 'read';
}

export interface Chat {
  id: string;
  user: User;
  lastMessage: Message;
  unreadCount: number;
}

export interface FriendRequest {
  id: string;
  userId: string;
  friendId: string;
  status: 'pending' | 'accepted' | 'rejected';
  user: User;
}
