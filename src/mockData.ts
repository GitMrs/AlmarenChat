import { Chat, Message, User } from './types';
import { subMinutes, subDays } from 'date-fns';

const CURRENT_USER_ID = 'me';

export const MOCK_USERS: User[] = [
  { id: 'u1', name: 'Spoony', avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&h=100&fit=crop', isOnline: true },
  { id: 'u2', name: 'Emerson Herwitz', avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&h=100&fit=crop', isOnline: true },
  { id: 'u3', name: 'Dulce Bator', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop', isOnline: false },
  { id: 'u4', name: 'Giana Torff', avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=100&h=100&fit=crop', isOnline: true },
  { id: 'u5', name: 'Livia Herwitz', avatar: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=100&h=100&fit=crop', isOnline: false },
  { id: 'u6', name: 'Audio message', avatar: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=100&h=100&fit=crop', isOnline: true },
  { id: 'u7', name: 'Ruben Dias', avatar: 'https://images.unsplash.com/photo-1619895862022-09114b41f16f?w=100&h=100&fit=crop', isOnline: false },
];

const loremIpsum = [
  "Hello! How are you?",
  "Yep, it'll be awesome.",
  "Bye!",
  "hot stuff here \ud83d\udd25 ui8.net",
  "\ud83d\ude31\ud83d\ude31\ud83d\ude31",
  "\u2764\ufe0f Ruben Dias \u2764\ufe0f",
  "just a sec",
  "I will send you some image",
  "That sounds great!",
  "Can't wait to see it.",
  "Are we still on for tomorrow?",
  "Let me check my schedule.",
  "Okay, sounds good.",
  "Thanks!",
  "No problem at all.",
  "Did you see the latest news?",
  "It's been a long day.",
  "I'm feeling much better now.",
  "What's your favorite color?",
  "I love pizza \ud83c\udf55"
];

// Helper to generate a deterministically random stream of messages
function createDummyMessages(count: number, otherUserId: string): Message[] {
  const messages: Message[] = [];
  const now = new Date();
  
  for (let i = 0; i < count; i++) {
    const isMe = i % 2 === 0;
    const msgType = i % 15 === 0 ? 'image' : 'text'; // Occasional images
    const textContent = loremIpsum[i % loremIpsum.length];
    
    let content = textContent;
    let imageUrls: string[] | undefined;

    if (msgType === 'image') {
      content = "Sent an image";
      // To prevent loading 100k real images and crashing the network tab or memory, 
      // we only simulate image urls for the last few, or just use a small set of cached images
      imageUrls = i > count - 100 ? [
        `https://picsum.photos/seed/${i}/300/400`,
        ...(i % 3 === 0 ? [`https://picsum.photos/seed/${i+1}/300/200`] : []) // Sometimes send multiple
      ] : [/* old images we might not even render to save memory, or placeholder */];
    } else if (textContent === "\ud83d\ude31\ud83d\ude31\ud83d\ude31") {
       // simulate audio message type slightly differently later if needed
    }

    // spread the timestamps over the last year
    const minutesAgo = (count - i) * 5; 
    
    messages.push({
      id: `msg_${i}`,
      senderId: isMe ? CURRENT_USER_ID : otherUserId,
      content,
      type: msgType,
      timestamp: subMinutes(now, minutesAgo).toISOString(),
      imageUrls,
    });
  }

  // Ensure the very last few messages match the screenshot vibe
  if (count > 0) {
    messages[count - 2] = {
      ...messages[count - 2],
      senderId: otherUserId,
      type: 'image',
      content: 'Sent images',
      imageUrls: [
        'https://images.unsplash.com/photo-1490750967868-88cb44cb2e26?w=400&h=300&fit=crop', // flowers
      ],
      timestamp: subMinutes(now, 2).toISOString(),
    };
     messages[count - 1] = {
      ...messages[count - 1],
      senderId: otherUserId,
      type: 'image',
      content: 'I will send you some image', // The text next to the image in screenshot? Actually screenshot shows text message below image.
      imageUrls: [
         'https://images.unsplash.com/photo-1518005020951-eccb494ad742?w=300&h=400&fit=crop' // anime-ish girl placeholder
      ],
      timestamp: subMinutes(now, 1).toISOString(),
    };
    
    // Add the specific text message from the screenshot
     messages.push({
      id: `msg_${count}`,
      senderId: CURRENT_USER_ID,
      type: 'text',
      content: 'I will send you some image',
      timestamp: now.toISOString(),
    });
  }
  return messages;
}

// Generate the chat list
export const mockChats: Chat[] = MOCK_USERS.map((user, index) => {
  const lastMessageTime = [
    subMinutes(new Date(), 15),
    subDays(new Date(), 1),
    new Date('2024-02-22T10:00:00Z'),
    new Date('2024-02-16T15:30:00Z'),
    new Date('2024-02-09T09:15:00Z'),
    new Date('2024-02-02T14:45:00Z'),
    new Date('2024-01-27T18:20:00Z'),
    new Date('2024-01-16T11:10:00Z')
  ][index % 8];

  return {
    id: `chat_${user.id}`,
    user,
    unreadCount: [99, 6, 20, 0, 0, 0, 0, 0][index % 8],
    lastMessage: {
      id: `last_msg_${user.id}`,
      senderId: user.id,
      content: loremIpsum[index % loremIpsum.length],
      type: 'text',
      timestamp: lastMessageTime.toISOString(),
    }
  };
});

// We expose a function to avoid locking up the main thread on initialization 
// if we don't need all 100k immediately, though it's fast enough in pure JS.
let cachedBigChat: Message[] | null = null;
export function getBigChatMessages(otherUserId: string): Message[] {
  if (!cachedBigChat) {
    // Generate 100,000 messages!
    cachedBigChat = createDummyMessages(100000, otherUserId); 
  }
  return cachedBigChat;
}

export const currentUserObj = { id: CURRENT_USER_ID, name: 'Me' };
