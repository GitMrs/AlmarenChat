import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { verifyToken } from './auth';
import prisma from './db';

// userId -> Set<socketId>
const onlineUsers = new Map<string, Set<string>>();

// ${chatId}:${userId} -> timeout
const typingTimers = new Map<string, NodeJS.Timeout>();

export function setupSocket(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  // JWT auth middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));
    const payload = verifyToken(token);
    if (!payload) return next(new Error('Invalid token'));
    (socket as any).userId = payload.userId;
    next();
  });

  io.on('connection', async (socket: Socket) => {
    const userId = (socket as any).userId;
    console.log(`User connected: ${userId} (socket: ${socket.id})`);

    // Track online status
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId)!.add(socket.id);

    // Update DB and broadcast if first connection
    if (onlineUsers.get(userId)!.size === 1) {
      await prisma.user.update({
        where: { id: userId },
        data: { isOnline: true },
      });

      // Notify all chat partners
      const chatUsers = await prisma.chatUser.findMany({
        where: { userId },
        select: { chatId: true },
      });
      for (const cu of chatUsers) {
        io.to(cu.chatId).emit('user_status', { userId, isOnline: true });
      }
    }

    // Join chat room
    socket.on('join_chat', ({ chatId }: { chatId: string }) => {
      socket.join(chatId);
      console.log(`User ${userId} joined chat ${chatId}`);
    });

    // Leave chat room
    socket.on('leave_chat', ({ chatId }: { chatId: string }) => {
      socket.leave(chatId);
      console.log(`User ${userId} left chat ${chatId}`);
    });

    // Send message
    socket.on('send_message', async (data: { chatId: string; content: string; type?: string }) => {
      try {
        const { chatId, content, type = 'text' } = data;

        // Save to DB
        const message = await prisma.message.create({
          data: {
            chatId,
            senderId: userId,
            content,
            type,
            status: 'sent',
          },
        });

        // Update chat timestamp
        await prisma.chat.update({
          where: { id: chatId },
          data: { updatedAt: new Date() },
        });

        // Broadcast to room
        const msgPayload = {
          id: message.id,
          chatId: message.chatId,
          senderId: message.senderId,
          content: message.content,
          type: message.type,
          status: message.status,
          timestamp: message.createdAt.toISOString(),
        };

        io.to(chatId).emit('new_message', msgPayload);

        // Mark as delivered for online recipients
        const chatParticipants = await prisma.chatUser.findMany({
          where: { chatId, userId: { not: userId } },
          select: { userId: true },
        });

        for (const participant of chatParticipants) {
          if (onlineUsers.has(participant.userId)) {
            await prisma.message.update({
              where: { id: message.id },
              data: { status: 'delivered' },
            });
            io.to(chatId).emit('message_status', {
              messageId: message.id,
              status: 'delivered',
            });
            break;
          }
        }

        console.log(`Message sent in chat ${chatId} by ${userId}`);
      } catch (err) {
        console.error('Error sending message:', err);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Typing indicators
    socket.on('typing_start', ({ chatId }: { chatId: string }) => {
      const key = `${chatId}:${userId}`;
      // Clear existing timer
      const existing = typingTimers.get(key);
      if (existing) clearTimeout(existing);

      // Broadcast to others in room
      socket.to(chatId).emit('typing_update', { chatId, userId, isTyping: true });

      // Auto-stop after 3 seconds
      const timer = setTimeout(() => {
        socket.to(chatId).emit('typing_update', { chatId, userId, isTyping: false });
        typingTimers.delete(key);
      }, 3000);
      typingTimers.set(key, timer);
    });

    socket.on('typing_stop', ({ chatId }: { chatId: string }) => {
      const key = `${chatId}:${userId}`;
      const existing = typingTimers.get(key);
      if (existing) {
        clearTimeout(existing);
        typingTimers.delete(key);
      }
      socket.to(chatId).emit('typing_update', { chatId, userId, isTyping: false });
    });

    // Message read
    socket.on('message_read', async ({ chatId, messageIds }: { chatId: string; messageIds: string[] }) => {
      try {
        await prisma.message.updateMany({
          where: { id: { in: messageIds }, chatId },
          data: { status: 'read' },
        });
        io.to(chatId).emit('messages_read', { chatId, messageIds });
      } catch (err) {
        console.error('Error marking messages as read:', err);
      }
    });

    // Disconnect
    socket.on('disconnect', async () => {
      console.log(`User disconnected: ${userId} (socket: ${socket.id})`);

      const userSockets = onlineUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          onlineUsers.delete(userId);

          // Update DB
          await prisma.user.update({
            where: { id: userId },
            data: { isOnline: false, lastSeen: new Date() },
          });

          // Notify all chat partners
          const chatUsers = await prisma.chatUser.findMany({
            where: { userId },
            select: { chatId: true },
          });
          for (const cu of chatUsers) {
            io.to(cu.chatId).emit('user_status', {
              userId,
              isOnline: false,
              lastSeen: new Date().toISOString(),
            });
          }
        }
      }

      // Clear typing timers
      for (const [key, timer] of typingTimers.entries()) {
        if (key.endsWith(`:${userId}`)) {
          clearTimeout(timer);
          typingTimers.delete(key);
        }
      }
    });
  });

  return io;
}
