'use client';

import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function connectSocket(): Socket {
  if (socket) return socket;

  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  socket = io(window.location.origin, {
    auth: { token },
    transports: ['websocket', 'polling'],
  });

  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
