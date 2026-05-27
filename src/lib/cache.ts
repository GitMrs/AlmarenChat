import { Message } from '../types';

const MAX_CACHED_MESSAGES = 100;

export function saveMessages(chatId: string, messages: Message[]) {
  try {
    const toCache = messages.slice(-MAX_CACHED_MESSAGES);
    localStorage.setItem(`chat:${chatId}:messages`, JSON.stringify(toCache));
  } catch (e) {
    // localStorage full or other error, ignore
  }
}

export function loadMessages(chatId: string): Message[] {
  try {
    const cached = localStorage.getItem(`chat:${chatId}:messages`);
    if (!cached) return [];
    return JSON.parse(cached);
  } catch {
    return [];
  }
}

export function appendMessage(chatId: string, message: Message) {
  const messages = loadMessages(chatId);
  // Avoid duplicates
  if (messages.some(m => m.id === message.id)) return;
  messages.push(message);
  saveMessages(chatId, messages);
}

export function clearMessages(chatId: string) {
  localStorage.removeItem(`chat:${chatId}:messages`);
}
