import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'almaren-chat-secret-key';
const onlineUsers = new Map();

export function setupSocket(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const payload = jwt.verify(token, JWT_SECRET);
      socket.userId = payload.userId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    console.log(`User connected: ${userId} (socket: ${socket.id})`);

    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socket.id);

    socket.on('join_conversation', ({ conversationId }) => {
      socket.join(conversationId);
    });

    socket.on('leave_conversation', ({ conversationId }) => {
      socket.leave(conversationId);
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${userId} (socket: ${socket.id})`);
      const userSockets = onlineUsers.get(userId);
      if (!userSockets) return;

      userSockets.delete(socket.id);
      if (userSockets.size === 0) {
        onlineUsers.delete(userId);
      }
    });
  });

  return io;
}
