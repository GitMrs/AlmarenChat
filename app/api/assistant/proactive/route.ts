import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ensurePersonalAssistant } from '@/lib/personal-assistant/profile';

export const runtime = 'nodejs';

function getBeijingHour(): number {
  const now = new Date();
  return (now.getUTCHours() + 8) % 24;
}

function generateProactiveGreeting(
  assistantName: string,
  memories: Array<{ content: string }>,
  bjHour: number
): string {
  // Check if any memories can be echoed
  const echoMemory = memories.find((m) => {
    const text = m.content.toLowerCase();
    return (
      text.includes('咖啡') ||
      text.includes('失眠') ||
      text.includes('睡') ||
      text.includes('茶') ||
      text.includes('猫') ||
      text.includes('狗')
    );
  });

  // Morning (6:00 - 10:59)
  if (bjHour >= 6 && bjHour < 11) {
    if (echoMemory && echoMemory.content.includes('咖啡')) {
      return `早安呀！今天的那杯咖啡喝了没？新的一天元气满满~ ☕`;
    }
    if (echoMemory && (echoMemory.content.includes('失眠') || echoMemory.content.includes('睡'))) {
      return `早呀！昨晚睡得还好吗？今天精神好点没？✨`;
    }
    const morningList = [
      `早安！今天状态怎么样？喝杯温水开启舒心的一天吧~ 🌿`,
      `早上好呀！新的一天又见面了，今天有想推进的小目标吗？✨`,
      `早呀！愿你今天思路清晰，心情轻盈，${assistantName}随时都在哦~ ☕`,
    ];
    return morningList[Math.floor(Math.random() * morningList.length)];
  }

  // Noon (11:00 - 13:59)
  if (bjHour >= 11 && bjHour < 14) {
    const noonList = [
      `中午好呀！忙碌了半天辛苦啦，记得按时吃顿美味的午餐 🍲`,
      `午间好！吃完饭不妨闭目养神一会儿，给大脑充充电~ 🌿`,
      `辛苦啦！午餐吃饱了吗？稍微歇歇眼睛，别一直盯着屏幕哦 🍵`,
    ];
    return noonList[Math.floor(Math.random() * noonList.length)];
  }

  // Afternoon (14:00 - 17:59)
  if (bjHour >= 14 && bjHour < 18) {
    if (echoMemory && echoMemory.content.includes('咖啡')) {
      return `下午好！下午容易犯困，要不要来杯咖啡提提神？☕`;
    }
    const afternoonList = [
      `下午好！坐久了容易疲劳，站起来活动下肩颈、喝口水再继续吧 💧`,
      `午后的一点温和问候~ 进度还顺利吗？累了就摸摸鱼换换脑子 🌿`,
      `下午状态怎么样？如果遇到卡住的想法，随时唤我一起理理思路 ✨`,
    ];
    return afternoonList[Math.floor(Math.random() * afternoonList.length)];
  }

  // Evening (18:00 - 22:59)
  if (bjHour >= 18 && bjHour < 23) {
    const eveningList = [
      `晚上好！今天忙碌了一整天，今晚打算好好放松一下吗？🌙`,
      `傍晚好呀！晚饭吃了吗？忙完手头的事，给自己留一点惬意时光吧 🍵`,
      `晚上好！这一天过得还顺心吗？有什么想聊聊的日常碎碎念吗？✨`,
    ];
    return eveningList[Math.floor(Math.random() * eveningList.length)];
  }

  // Midnight / Late night (23:00 - 05:59)
  const nightList = [
    `夜深了，还在忙呢？别太熬夜，手头的事明天再做也来得及，早点休息哦 🌙`,
    `这么晚还没休息呀？揉揉酸痛的眼睛，早点钻进被窝睡个好觉吧 ✨`,
    `夜深人静啦，注意身体别硬撑，小伴祝你今晚有个好梦 🕊️`,
  ];
  return nightList[Math.floor(Math.random() * nightList.length)];
}

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const profile = await ensurePersonalAssistant(userId);

    if (profile.proactiveEnabled === false) {
      return NextResponse.json({ shouldGreet: false, reason: 'disabled' });
    }

    const memories = await prisma.assistantMemoryItem.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { content: true },
      take: 20,
    });

    const bjHour = getBeijingHour();
    const greeting = generateProactiveGreeting(profile.name || '小伴', memories, bjHour);

    return NextResponse.json({
      shouldGreet: true,
      greeting,
      assistantName: profile.name || '小伴',
      assistantAvatar: profile.avatar || '🌿',
      hour: bjHour,
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ shouldGreet: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const profile = await ensurePersonalAssistant(userId);
    const body = await request.json().catch(() => ({}));
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 1000) : '';
    if (!text) {
      return NextResponse.json({ error: 'Text required' }, { status: 400 });
    }

    const message = await prisma.message.create({
      data: {
        conversationId: profile.conversationId,
        role: 'assistant',
        content: text,
      },
    });

    return NextResponse.json({
      message: {
        id: message.id,
        conversationId: message.conversationId,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      },
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
