import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'almaren-chat-secret-key';

// userId -> Set<socketId>
const onlineUsers = new Map<string, Set<string>>();

export function setupSocket(io: Server) {
  // JWT auth middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
      (socket as any).userId = payload.userId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const userId = (socket as any).userId;
    console.log(`User connected: ${userId} (socket: ${socket.id})`);

    // Track online status
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId)!.add(socket.id);

    // Join conversation room
    socket.on('join_conversation', ({ conversationId }: { conversationId: string }) => {
      socket.join(conversationId);
    });

    // Leave conversation room
    socket.on('leave_conversation', ({ conversationId }: { conversationId: string }) => {
      socket.leave(conversationId);
    });

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${userId} (socket: ${socket.id})`);
      const userSockets = onlineUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          onlineUsers.delete(userId);
        }
      }
    });
  });

  return io;
}
